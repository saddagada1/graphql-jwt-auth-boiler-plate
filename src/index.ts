import "reflect-metadata";
import "dotenv/config";
import { AppDataSource } from "./data-source";
import express from "express";
import { ApolloServer } from "apollo-server-express";
import { buildSchema } from "type-graphql";
import { UserResolver } from "./resolvers/user";
import { User } from "./entity/User";
import Redis from "ioredis";
import refreshRoute from "./routes/refreshToken";
import cookieParser from "cookie-parser";

const main = async () => {
  AppDataSource.initialize()
    .then(async () => {
      console.log("connected with typeorm");
      //await User.delete({})
    })
    .catch((error) => console.log(error));

  const redis = new Redis();
  redis.on("error", (err) => console.log("Redis Client Error", err));

  const app = express();

  app.use(cookieParser());

  app.use("/refresh_token", refreshRoute);

  app.get("/", (_req, res) => {
    res.send("hello world");
  });

  const apolloServer = new ApolloServer({
    schema: await buildSchema({
      resolvers: [UserResolver],
      validate: false,
    }),
    context: ({ req, res }) => ({ req, res, redis }),
  });

  await apolloServer.start();
  apolloServer.applyMiddleware({ app });

  app.listen(8080, () => {
    console.log("express server started on port: 8080");
  });
};

main().catch((err) => {
  console.error(err);
});
