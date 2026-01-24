require("dotenv").config();
const app = require("./src/app");

const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, () => {
  console.log("Server running:", `http://127.0.0.1:${PORT}`);
});
