// app.js
const express = require("express");
const path = require("path");
const session = require("express-session");
const cookieParser = require("cookie-parser");

const { rememberMeMiddleware } = require("./middleware/auth");

// Routes
const configRoutes = require("./routes/config.routes");
const authRoutes = require("./routes/auth.routes");
const gmailRoutes = require("./routes/gmail.routes");
const listRoutes = require("./routes/lists.routes");
const campaignRoutes = require("./routes/campaigns.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const trackingRoutes = require("./routes/tracking.routes");
const debugRoutes = require("./routes/debug.routes");

const { startScheduler } = require("./scheduler/scheduler");

const app = express();

app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // local dev (prod: true when https)
      maxAge: 1000 * 60 * 60 * 2,
    },
  }),
);

// remember-me before routes
app.use(rememberMeMiddleware);

// 🔎 Debug log for all /api requests (helps when "terminal has no errors")
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    console.log("[API]", req.method, req.path, "user:", req.session?.user?.id);
  }
  next();
});

// Static
app.use("/public", express.static(path.join(__dirname, "..", "public")));
app.get("/", (req, res) => res.redirect("/public/compose.html"));

// API
app.use(configRoutes);
app.use(authRoutes);
app.use(gmailRoutes);
app.use(listRoutes);
app.use(campaignRoutes);
app.use(dashboardRoutes);
app.use(trackingRoutes);
app.use(debugRoutes);

// Start in-process scheduler
startScheduler();

module.exports = app;
