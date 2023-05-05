import { verify } from "jsonwebtoken";
import { Request, Response, Router } from "express";
import { User } from "../entity/User";
import { AuthPayload } from "../utils/types";
import { createAccessToken, createRefreshToken } from "../utils/auth";
import { ACCESS_TOKEN_EXPIRES_IN } from "../utils/constants";

interface RefreshTokenResponse {
  ok: boolean;
  access_token: string;
  expires_in: number;
  user: User;
}

const refreshRoute = Router();

refreshRoute.post(
  "/",
  async (req: Request, res: Response<RefreshTokenResponse | { error: string }>) => {
    try {
      const token = req.cookies.qid;
      const payload = verify(token, process.env.REFRESH_TOKEN_SECRET!);
      const authPayload = payload as AuthPayload;
      const user = await User.findOne({ where: { id: authPayload.user_id } });
      if (!user) {
        throw "Bad Request";
      }
      if (user.token_version !== authPayload.token_version) {
        throw "Bad Request";
      }

      res.cookie("qid", createRefreshToken(user), { httpOnly: true, path: "/refresh_token" });

      return res.status(200).send({
        ok: true,
        access_token: createAccessToken(user),
        expires_in: ACCESS_TOKEN_EXPIRES_IN,
        user: user,
      });
    } catch (err) {
      console.error(err);
      return res.status(401).send({
        error: "Failed to Refresh Token",
      });
    }
  }
);

export default refreshRoute;
