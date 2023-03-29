module.exports = {
  debug: function debug(x) {
    const verbose = process.env.LOG_DEBUG ? true : false;
    if (verbose) {
      console.log(x);
    }
  },

  info: function info(x) {
    console.log(x);
  },

  warn: function (x) {
    console.warn(x);
  },

  error: function (x) {
    console.error(x);
  },
};
