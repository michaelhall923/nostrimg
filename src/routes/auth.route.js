const express = require("express");
const axios = require("axios");

const router = express.Router();

// Setup BTCPay config
const btcpayserverurl = "https://bps.nostrimg.com";
const btcPayServertoken = process.env.BTC_PAY_SERVER_TOKEN;
const btcPayServerConfig = {
  headers: {
    "Content-Type": "application/json",
    Authorization: "token " + btcPayServertoken,
  },
};

// Initiate authentication
router.get("/auth/init", async (req, res) => {
  // Check if auth invoice is expired
  var generateNewInvoice = false;
  if (req.session.authInvoiceId) {
    if (Date.now() / 1000 >= req.session.authInvoiceExpirationTime) {
      generateNewInvoice = true;
    }
  } else {
    generateNewInvoice = true;
  }

  // Generate auth invoice if needed
  if (generateNewInvoice) {
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
      },
      receipt: {
        enabled: true,
        showQR: null,
        showPayments: null,
      },
      amount: "615",
      currency: "SATS",
      additionalSearchTerms: ["string"],
    };

    // Send req for new invoice
    await axios
      .post(btcpayserverurl + apiendpoint, body, btcPayServerConfig)
      .then(async (response) => {
        req.session.authInvoiceId = response.data.id;
        req.session.authInvoiceExpirationTime = response.data.expirationTime;
        apiendpoint = `/api/v1/stores/${process.env.BTC_PAY_SERVER_STORE_ID}/invoices/${response.data.id}/payment-methods`;

        // Get invoice payment methods
        await axios
          .get(btcpayserverurl + apiendpoint, btcPayServerConfig)
          .then((response) => {
            var invoice = response.data[0];

            // Send invoice to client
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
  } else {
    var apiendpoint = `/api/v1/stores/${process.env.BTC_PAY_SERVER_STORE_ID}/invoices/${req.session.authInvoiceId}/payment-methods`;

    // Get invoice payment methods
    await axios
      .get(btcpayserverurl + apiendpoint, btcPayServerConfig)
      .then((response) => {
        var invoice = response.data[0];

        // Send invoice to client
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
  }
});

// Verify that client is authenticated
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

      // Check if auth invoice has been paid
      await axios
        .get(btcpayserverurl + apiendpoint, authVerifyBtcPayServerConfig)
        .then((response) => {
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
  // Send auth status to client
  res.status(200).send({
    isAuthenticated: req.session.isAuthenticated,
    authInvoiceId: req.session.authInvoiceId,
  });
});

module.exports = router;
