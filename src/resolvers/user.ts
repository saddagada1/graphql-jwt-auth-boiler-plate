import { MyContext } from "../utils/types";
import {
  Resolver,
  Query,
  Mutation,
  InputType,
  Field,
  Arg,
  Ctx,
  ObjectType,
  UseMiddleware,
} from "type-graphql";
import argon2 from "argon2";
import { User } from "../entity/User";
import {
  ACCESS_TOKEN_EXPIRES_IN,
  FORGOT_PASSWORD_PREFIX,
  VERIFY_EMAIL_PREFIX,
} from "../utils/constants";
import { sendEmail } from "../utils/sendEmail";
import { isAuth } from "../middleware/isAuth";
import { AppDataSource } from "../data-source";
import { createAccessToken, createRefreshToken, generateOTP } from "../utils/auth";

@InputType()
class RegisterInput {
  @Field()
  email: string;
  @Field()
  username: string;
  @Field()
  password: string;
}

@InputType()
class LoginInput {
  @Field()
  email: string;
  @Field()
  password: string;
}

@InputType()
class ChangePasswordInput {
  @Field()
  oldPassword: string;
  @Field()
  newPassword: string;
}

@InputType()
class ChangeForgotPasswordInput {
  @Field()
  email: string;
  @Field()
  token: string;
  @Field()
  password: string;
}

@ObjectType()
class FieldError {
  @Field()
  field: string;
  @Field()
  message: string;
}

@ObjectType()
class Auth {
  @Field()
  access_token: string;
  @Field()
  expires_in: number;
}

@ObjectType()
class UserResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[];

  @Field(() => User, { nullable: true })
  user?: User;
}

@ObjectType()
class AuthResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[];

  @Field(() => User, { nullable: true })
  user?: User;

  @Field(() => Auth, { nullable: true })
  auth?: Auth;
}

@Resolver()
export class UserResolver {
  @Mutation(() => AuthResponse)
  async register(
    @Arg("registerOptions") registerOptions: RegisterInput,
    @Ctx() { redis, res }: MyContext
  ): Promise<AuthResponse> {
    const hashedPassword = await argon2.hash(registerOptions.password);
    let user;
    try {
      user = await User.create({
        email: registerOptions.email,
        username: registerOptions.username,
        password: hashedPassword,
      }).save();
    } catch (err) {
      console.log(err);
      if (err.code === "23505") {
        if (err.detail.includes("username")) {
          return {
            errors: [
              {
                field: "username",
                message: `Username Taken`,
              },
            ],
          };
        }
        if (err.detail.includes("email")) {
          return {
            errors: [
              {
                field: "email",
                message: `Email in Use`,
              },
            ],
          };
        }
      }
    }

    if (!user) {
      return {
        errors: [
          {
            field: "username",
            message: `Server Error: Unable to Create User`,
          },
        ],
      };
    }

    const token = await generateOTP();

    await redis.set(VERIFY_EMAIL_PREFIX + user.id, token, "EX", 1000 * 60 * 60); // 1 hour

    const emailBody = `Your Token is: ${token}`;

    sendEmail(user.email, "REMASTER - VERIFY EMAIL", emailBody);

    res.cookie("qid", createRefreshToken(user), { httpOnly: true, path: "/refresh_token" });

    return {
      user: user,
      auth: {
        access_token: createAccessToken(user),
        expires_in: ACCESS_TOKEN_EXPIRES_IN,
      },
    };
  }

  @Mutation(() => AuthResponse)
  async login(
    @Arg("loginOptions") loginOptions: LoginInput,
    @Ctx() { res }: MyContext
  ): Promise<AuthResponse> {
    const user = await User.findOne({ where: { email: loginOptions.email } });
    if (!user) {
      return {
        errors: [
          {
            field: "email",
            message: "Invalid Email or Password",
          },
        ],
      };
    }

    const isValid = await argon2.verify(user.password, loginOptions.password);
    if (!isValid) {
      return {
        errors: [
          {
            field: "email",
            message: "Invalid Email or Password",
          },
        ],
      };
    }

    res.cookie("qid", createRefreshToken(user), { httpOnly: true, path: "/refresh_token" });

    return {
      user: user,
      auth: {
        access_token: createAccessToken(user),
        expires_in: ACCESS_TOKEN_EXPIRES_IN,
      },
    };
  }

  @Mutation(() => UserResponse)
  @UseMiddleware(isAuth)
  async changeUsername(
    @Arg("username") username: string,
    @Ctx() { user_payload }: MyContext
  ): Promise<UserResponse> {
    const duplicateUser = await User.findOne({
      where: { username: username },
    });
    if (duplicateUser) {
      return {
        errors: [
          {
            field: "username",
            message: "Username Taken",
          },
        ],
      };
    }

    const result = await AppDataSource.createQueryBuilder()
      .update(User)
      .set({ username: username })
      .where({ id: user_payload!.user.id })
      .returning("*")
      .execute();

    return { user: result.raw[0] };
  }

  @Mutation(() => UserResponse)
  @UseMiddleware(isAuth)
  async changeEmail(
    @Arg("email") email: string,
    @Ctx() { user_payload }: MyContext
  ): Promise<UserResponse> {
    const duplicateUser = await User.findOne({ where: { email: email } });
    if (duplicateUser) {
      return {
        errors: [
          {
            field: "email",
            message: "Email in Use",
          },
        ],
      };
    }

    const result = await AppDataSource.createQueryBuilder()
      .update(User)
      .set({ email: email })
      .where({ id: user_payload!.user.id })
      .returning("*")
      .execute();

    return { user: result.raw[0] };
  }

  @Mutation(() => UserResponse)
  @UseMiddleware(isAuth)
  async changePassword(
    @Arg("changePasswordOptions") changePasswordOptions: ChangePasswordInput,
    @Ctx() { user_payload }: MyContext
  ): Promise<UserResponse> {
    const isValid = await argon2.verify(
      user_payload!.user.password,
      changePasswordOptions.oldPassword
    );
    if (!isValid) {
      return {
        errors: [
          {
            field: "oldPassword",
            message: "Incorrect Password",
          },
        ],
      };
    }

    await User.update(
      { id: user_payload!.user.id },
      { password: await argon2.hash(changePasswordOptions.newPassword) }
    );

    return { user: user_payload!.user };
  }

  @Mutation(() => AuthResponse)
  async changeForgotPassword(
    @Arg("changeForgotPasswordOptions")
    changeForgotPasswordOptions: ChangeForgotPasswordInput,
    @Ctx() { redis, res }: MyContext
  ): Promise<AuthResponse> {
    const key = FORGOT_PASSWORD_PREFIX + changeForgotPasswordOptions.email;

    const value = await redis.get(key);
    if (!value) {
      return {
        errors: [
          {
            field: "token",
            message: `Token Expired`,
          },
        ],
      };
    }

    const userID = value.split(":")[0];
    const storedToken = value.split(":")[1];

    if (changeForgotPasswordOptions.token !== storedToken) {
      return {
        errors: [
          {
            field: "token",
            message: `Token Invalid`,
          },
        ],
      };
    }

    const numUserID = parseInt(userID);

    const result = await AppDataSource.createQueryBuilder()
      .update(User)
      .set({
        password: await argon2.hash(changeForgotPasswordOptions.password),
        token_version: () => "token_version + 1",
      })
      .where({ id: numUserID })
      .returning("*")
      .execute();

    await redis.del(key);

    res.cookie("qid", createRefreshToken(result.raw[0]), {
      httpOnly: true,
      path: "/refresh_token",
    });

    return {
      user: result.raw[0],
      auth: {
        access_token: createAccessToken(result.raw[0]),
        expires_in: ACCESS_TOKEN_EXPIRES_IN,
      },
    };
  }

  @Mutation(() => Boolean)
  async forgotPassword(@Arg("email") email: string, @Ctx() { redis }: MyContext) {
    const user = await User.findOne({ where: { email: email } });
    if (!user) {
      return true;
    }

    const key = FORGOT_PASSWORD_PREFIX + user.email;

    const duplicate = await redis.exists(key);

    if (duplicate !== 0) {
      await redis.del(key);
    }

    const token = await generateOTP();

    await redis.set(key, `${user.id}:${token}`, "EX", 1000 * 60 * 60); // 1 hour

    const emailBody = `Your Token is: ${token}`;

    sendEmail(email, "REMASTER - FORGOT PASSWORD", emailBody);

    return true;
  }

  @Mutation(() => UserResponse)
  @UseMiddleware(isAuth)
  async verifyEmail(
    @Arg("token") token: string,
    @Ctx() { user_payload, redis }: MyContext
  ): Promise<UserResponse> {
    const key = VERIFY_EMAIL_PREFIX + user_payload!.user.id;

    const storedToken = await redis.get(key);
    if (!storedToken) {
      return {
        errors: [
          {
            field: "token",
            message: `Token Expired`,
          },
        ],
      };
    }

    if (storedToken !== token) {
      return {
        errors: [
          {
            field: "token",
            message: `Token Invalid`,
          },
        ],
      };
    }

    const result = await AppDataSource.createQueryBuilder()
      .update(User)
      .set({ verified: true })
      .where({ id: user_payload!.user.id })
      .returning("*")
      .execute();

    await redis.del(key);

    return { user: result.raw[0] };
  }

  @Mutation(() => Boolean)
  @UseMiddleware(isAuth)
  async sendVerifyEmail(@Ctx() { user_payload, redis }: MyContext) {
    const key = VERIFY_EMAIL_PREFIX + user_payload!.user.id;

    const duplicate = await redis.exists(key);

    if (duplicate !== 0) {
      await redis.del(key);
    }

    const token = await generateOTP();

    await redis.set(key, token, "EX", 1000 * 60 * 60); // 1 hour

    const emailBody = `Your Token is: ${token}`;

    sendEmail(user_payload!.user.email, "REMASTER - VERIFY EMAIL", emailBody);

    return true;
  }

  @Query(() => [User])
  @UseMiddleware(isAuth)
  users(): Promise<User[]> {
    return User.find();
  }
}
