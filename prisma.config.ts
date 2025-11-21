import { defineConfig } from "prisma/config";
import { config as loadEnv } from "dotenv";

// Cargar variables de entorno desde .env
loadEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Usamos process.env directamente
    url: process.env.DATABASE_URL!,
  },
});
