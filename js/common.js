module.exports = {
  debug(x) {
    const verbose = process.env.LOG_DEBUG ? true : false // eslint-disable-line
    if (verbose) {
      console.log(x); // eslint-disable-line
    }
  },

  info(x) {
    console.log(x); // eslint-disable-line
  },

  warn(x) {
    console.warn(x); // eslint-disable-line
  },

  error(x) {
    console.error(x); // eslint-disable-line
  },
};

exports = module.exports;
