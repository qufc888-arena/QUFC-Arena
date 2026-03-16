const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.send("QUFC Arena Server Running");
});

app.listen(PORT, () => {
  console.log("QUFC Arena running on port " + PORT);
});
