import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Thiếu DATABASE_URL. Ví dụ mysql://scm:scm@127.0.0.1:3306/hoang_nhat");

export const prisma = new PrismaClient({
  datasources: { db: { url } },
});
