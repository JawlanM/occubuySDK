import { connectDB } from "./config/db";

connectDB()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Connection failed:", err);
        process.exit(1);
    });