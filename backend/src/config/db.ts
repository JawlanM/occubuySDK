import mongoose from "mongoose";
import dotenv from "dotenv";
import { setServers } from "dns";

//dotenv reads .env

// loads variables from .env into process.env
dotenv.config();

// some ISP/router DNS resolvers don't answer Node's own SRV lookups even though the OS
// resolver handles them fine (nslookup works, node's dns.resolveSrv doesn't) - this breaks
// mongodb+srv:// connection strings specifically. pointing node at a public resolver fixes it.
setServers(["8.8.8.8", "1.1.1.1"]);

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is not set in your .env file.");
  }

  //cal to open connection
  await mongoose.connect(uri);
  console.log("MongoDB connected:", mongoose.connection.name);
}