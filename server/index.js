const express = require("express");
const cors = require("cors");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const AWS = require("aws-sdk");
const sharp = require("sharp");
const axios = require("axios");
const session = require("express-session");
const PostgreSQLStore = require("connect-pg-simple")(session);
const pg = require("pg");
const { resolveSoa } = require("dns");
// const pgSession = require("express-pg-session")(session);

if (process.env.NODE_ENV == "development") {
  require("dotenv").config();
}

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
          // ca: fs.readFileSync(
          //     `${process.cwd()}/cert/ca-certificate.crt`.toString()
          // ),
          ca: process.env.CA_CERT,
        },
});

const PORT = process.env.PORT || 3001;

const app = express();
const router = express.Router();

const btcpayserverurl = "https://bps.nostrimg.com";
const btcPayServertoken = process.env.BTC_PAY_SERVER_TOKEN;
const btcPayServerConfig = {
  headers: {
    "Content-Type": "application/json",
    Authorization: "token " + btcPayServertoken,
  },
};

const MAX_FILE_SIZE = 5;

/// Set up multer to handle file uploads
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * MAX_FILE_SIZE, // Limit file size to 5 MB
  },
  fileFilter: (req, file, cb) => {
    // Allow image files and GIFs
    if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp|gif)$/)) {
      return cb(
        new Error(
          "Invalid file type. Please upload a file in one of the following formats: jpeg, jpg, png, gif, or webp."
        )
      );
    }

    cb(null, true);
  },
});

const uploadSingleImage = upload.single("image");

router.use(
  session({
    secret: process.env.SESSION_SECRET_KEY,
    cookie: {
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
    resave: false,
    saveUninitialized: true,
    // store: new PostgreSQLStore({
    //   conString: process.env.DATABASE_URL,
    //   createTableIfMissing: true,
    //   ssl: true,
    // }),
    store: new PostgreSQLStore({
      pool: pgPool, // Connection pool
      createTableIfMissing: true,
    }),
  })
);

router.use(
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

router.get("/e112d442c7e112d442c7e112d442c7", (req, res) => {
  res.status(200).send({
    CA_CERT: process.env.CA_CERT,
  });
});

router.get("/auth/init", async (req, res) => {
  var apiendpoint = `/api/v1/stores/${process.env.BTC_PAY_SERVER_STORE_ID}/invoices`;

  var body = {
    metadata: {
      buyerAddress1: "string",
    },
    checkout: {
      speedPolicy: "HighSpeed",
      paymentMethods: ["BTC-LightningNetwork"],
      defaultPaymentMethod: "BTC-LightningNetwork",
      expirationMinutes: 90,
      monitoringMinutes: 90,
      paymentTolerance: 0,
      redirectURL: "string",
      redirectAutomatically: true,
      requiresRefundEmail: false,
      checkoutType: null,
      // defaultLanguage: "string",
    },
    receipt: {
      enabled: true,
      showQR: null,
      showPayments: null,
    },
    amount: "100",
    currency: "SATS",
    additionalSearchTerms: ["string"],
  };

  await axios
    .post(btcpayserverurl + apiendpoint, body, btcPayServerConfig)
    .then(async (response) => {
      req.session.authInvoiceId = response.data.id;
      // console.log(response.data);
      apiendpoint = `/api/v1/stores/${process.env.BTC_PAY_SERVER_STORE_ID}/invoices/${response.data.id}/payment-methods`;

      await axios
        .get(btcpayserverurl + apiendpoint, btcPayServerConfig)
        .then((response) => {
          var invoice = response.data[0];
          // Return the fileName to the client

          var url = "https://nostrimg.com/";
          var imageUrl = "https://i.nostrimg.com/";
          if (process.env.NODE_ENV == "development") {
            url = "http://nostrimg.com/";
          }

          return res.status(200).send({
            lightningDestination: invoice.destination,
            lightningPaymentLink: invoice.paymentLink,
            authInvoiceId: req.session.authInvoiceId,
          });
        })
        .catch((error) => {
          console.error(error);
          return res.status(500).send();
        });
    })
    .catch((error) => {
      console.error(error);
      res.status(500).send();
    });
});

router.get("/auth/verify", async (req, res) => {
  if (req.session.isAuthenticated) {
  } else {
    req.session.isAuthenticated = false;
    if (req.session.authInvoiceId) {
      var apiendpoint = `/api/v1/stores/${process.env.BTC_PAY_SERVER_STORE_ID}/invoices`;
      var authVerifyBtcPayServerConfig = btcPayServerConfig;
      authVerifyBtcPayServerConfig.params = {
        textSearch: req.session.authInvoiceId,
      };

      await axios
        .get(btcpayserverurl + apiendpoint, authVerifyBtcPayServerConfig)
        .then((response) => {
          // console.log(response.data[0].status);
          if (response.data[0].status == "Settled") {
            req.session.isAuthenticated = true;
          }
        })
        .catch((error) => {
          console.error(error);
          res.status(500).send();
        });
    }
  }
  res.status(200).send({
    isAuthenticated: req.session.isAuthenticated,
    authInvoiceId: req.session.authInvoiceId,
  });
});

router.post(
  "/upload",
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
  }),
  async (req, res) => {
    if (!req.session.isAuthenticated) {
      return res.status(401).send({
        session: req.session,
      });
    }
    await uploadSingleImage(req, res, async function (err) {
      if (err) {
        if (err.code == "LIMIT_FILE_SIZE")
          err.message = `The file you are trying to upload is too large. Please choose a file with a size less than ${MAX_FILE_SIZE}MB and try again.`;
        return res.status(400).send({ message: err.message });
      }

      // console.log(Object.keys(req.file));
      // console.log(req.file.mimetype);

      // Compress the image using Sharp
      if (
        req.file.mimetype == "image/jpeg" ||
        req.file.mimetype == "image/jpg"
      ) {
        req.file.buffer = await sharp(req.file.buffer)
          .jpeg({ quality: 70 })
          .toBuffer();
      } else if (req.file.mimetype == "image/png") {
        req.file.buffer = await sharp(req.file.buffer)
          .png({ quality: 90 })
          .toBuffer();
      } else if (req.file.mimetype == "image/webp") {
        req.file.buffer = await sharp(req.file.buffer)
          .webp({ quality: 80 })
          .toBuffer();
      } else if (req.file.mimetype == "image/gif") {
      }

      try {
        // Set up the S3 client
        const s3 = new AWS.S3({
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        });

        // Generate a random 8 character 64-bit string for the filename
        const fileID = crypto.randomBytes(4).toString("hex");

        const fileName = fileID + path.extname(req.file.originalname);

        // Upload the file to the S3 bucket
        const s3Response = await s3
          .putObject({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: fileName,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
          })
          .promise();

        // var invoice = response.data[0];
        // Return the fileName to the client

        var url = "https://nostrimg.com/";
        var imageUrl = "https://i.nostrimg.com/";
        if (process.env.NODE_ENV == "development") {
          url = "http://nostrimg.com/";
        }

        return res.send({
          route: `/i/${fileName}`,
          url: `${url}i/${fileName}`,
          imageUrl: `${imageUrl}${fileName}`,
          fileName: fileName,
          fileID: fileID,
          message: "Image uploaded successfully.",
          lightningDestination: process.env.BTC_PAY_SERVER_LNURL,
          lightningPaymentLink: `lightning:${process.env.BTC_PAY_SERVER_LNURL}`,
        });
      } catch (err) {
        // Handle errors
        console.error(err);
        return res.status(500).send({ message: err.message });
      }
    });
  }
);

// router.listen(8000, () => {
//   console.log("Server listening on port 8000");
// });

router.get("/", (req, res) => {
  res.json({ message: "Hello from server!" });
});

if (process.env.NODE_ENV == "development") {
  app.use("/api", router);
} else {
  app.use("/", router);
}

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
