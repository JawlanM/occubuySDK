import mongoose from "mongoose";
import dotenv from "dotenv";

//dotenv reads .env

// loads variables from .env into process.env
dotenv.config();

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is not set in your .env file.");
  }

  //cal to open connection
  await mongoose.connect(uri);
  console.log("MongoDB connected:", mongoose.connection.name);
}