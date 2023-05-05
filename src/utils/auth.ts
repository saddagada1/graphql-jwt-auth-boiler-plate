import { sign } from "jsonwebtoken";
import { User } from "src/entity/User";
import { ACCESS_TOKEN_EXPIRES_IN, REFRESH_TOKEN_EXPIRES_IN } from "./constants";
import { randomBytes } from "crypto";

export const createAccessToken = (user: User) => {
  return sign(
    { user_id: user.id, token_version: user.token_version },
    process.env.ACCESS_TOKEN_SECRET!,
    {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    }
  );
};

export const createRefreshToken = (user: User) => {
  return sign(
    { user_id: user.id, token_version: user.token_version },
    process.env.REFRESH_TOKEN_SECRET!,
    { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
  );
};

export const generateOTP = async () => {
  const buffer = randomBytes(3);
  return parseInt(buffer.toString("hex"), 16).toString().slice(0, 6);
};
