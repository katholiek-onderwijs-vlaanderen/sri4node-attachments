module.exports = {
  debug: function debug(x) {
    var verbose = process.env.LOG_DEBUG ? true : false; // eslint-disable-line
    if (verbose) {
      console.log(x); // eslint-disable-line
    }
  },

  info: function info(x) {
    console.log(x); // eslint-disable-line
  },

  warn: function (x) {
    console.warn(x); // eslint-disable-line
  },

  error: function (x) {
    console.error(x); // eslint-disable-line
  },
};
