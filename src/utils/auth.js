const FREE_UPLOADS = 2;

const isAuthenticated = (req) => {
  return req.session.isAuthenticated || req.session.totalUploads < FREE_UPLOADS;
};

module.exports = {
  isAuthenticated,
};
