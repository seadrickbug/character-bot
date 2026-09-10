import express from "express";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello from the API!");
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Backend API is connected" });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
