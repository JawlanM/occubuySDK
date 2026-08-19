require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");

const app = express();
app.use(express.json());

const API_KEY = process.env.PROXY_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set");
  process.exit(1);
}
if (!API_KEY) {
  console.error("PROXY_API_KEY is not set");
  process.exit(1);
}

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err);
    process.exit(1);
  });

// unauthenticated, needs to stay reachable for Render's health check
app.get("/", (_req, res) => {
  res.status(200).send("db-proxy is up");
});

// same header name Atlas's Data API used, so the backend's existing client didn't need
// to change at all beyond pointing MONGODB_DATA_API_URL at this service instead
function requireApiKey(req, res, next) {
  if (req.headers["api-key"] !== API_KEY) {
    return res.status(401).json({ error: "invalid or missing api-key" });
  }
  next();
}

app.use(requireApiKey);

// turns { _id: { $oid: "<hex>" } } into a real ObjectId - that's the only extended-JSON
// shape the backend's client ever sends
function resolveFilter(filter) {
  if (filter && typeof filter === "object" && filter._id && filter._id.$oid) {
    return { ...filter, _id: new mongoose.Types.ObjectId(filter._id.$oid) };
  }
  return filter;
}

function serializeDoc(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { ...rest, _id: _id.toString() };
}

app.post("/action/findOne", async (req, res) => {
  try {
    const { database, collection, filter } = req.body;
    const doc = await mongoose.connection
      .useDb(database)
      .collection(collection)
      .findOne(resolveFilter(filter));
    res.json({ document: serializeDoc(doc) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/action/insertOne", async (req, res) => {
  try {
    const { database, collection, document } = req.body;
    const result = await mongoose.connection
      .useDb(database)
      .collection(collection)
      .insertOne(document);
    res.json({ insertedId: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/action/updateOne", async (req, res) => {
  try {
    const { database, collection, filter, update } = req.body;
    const result = await mongoose.connection
      .useDb(database)
      .collection(collection)
      .updateOne(resolveFilter(filter), update);
    res.json({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`db-proxy listening on ${PORT}`));
