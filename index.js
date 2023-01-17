// Use dev env vars
if (process.env.NODE_ENV == "development") {
  require("dotenv").config();
}

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const PostgreSQLStore = require("connect-pg-simple")(session);
const pg = require("pg");

const authRouter = require("./src/routes/auth.route");
const uploadRouter = require("./src/routes/upload.route");

const app = express();

// Create postgres pool
const pgPool = new pg.Pool({
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  port: process.env.PG_PORT,
  ssl:
    process.env.NODE_ENV == "development"
      ? null
      : {
          rejectUnauthorized: true,
          ca: process.env.CA_CERT,
        },
});

// Setup sessions
app.use(
  session({
    secret: process.env.SESSION_SECRET_KEY,
    cookie: {
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
    resave: false,
    saveUninitialized: true,
    store: new PostgreSQLStore({
      pool: pgPool,
      createTableIfMissing: true,
    }),
  })
);

// Set default CORS policy
app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        "http://localhost:3000",
        "https://nostrimg.com",
        "https://www.nostrimg.com",
      ];
      if (
        allowedOrigins.includes(origin) ||
        origin === undefined ||
        process.env.NODE_ENV == "development"
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS: " + origin));
      }
    },
    methods: ["POST"],
    allowedHeaders: ["Content-Type", "Authorization", "Pragma"],
    credentials: true,
  })
);

app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return next();
  }

  const auth = Buffer.from(authHeader.split(" ")[1], "base64")
    .toString()
    .split(":");
  const username = auth[0];
  const password = auth[1];

  // check if the user is valid
  if (username === process.env.USERNAME && password === process.env.PASSWORD) {
    req.session.isAuthenticated = true;
  }
  next();
});

const PORT = process.env.PORT || 3001;
const PATH = process.env.NODE_ENV == "development" ? "/api" : "/";

// Add routers
app.use(PATH, uploadRouter);
app.use(PATH, authRouter);

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
