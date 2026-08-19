import { app } from "./app";

const PORT = process.env.PORT ?? 8787;

app.listen(PORT, () => {
  console.log(`Occubuy backend listening on http://localhost:${PORT}`);
});
