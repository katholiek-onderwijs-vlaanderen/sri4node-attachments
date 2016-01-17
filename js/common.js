exports = module.exports = {
  debug: function (x) {
    'use strict';
    var verbose = process.env.LOG_DEBUG ? true : false // eslint-disable-line
    if (verbose) {
      console.log(x); // eslint-disable-line
    }
  },

  info: function (x) {
    'use strict';
    console.log(x); // eslint-disable-line
  },

  warn: function (x) {
    'use strict';
    console.warn(x); // eslint-disable-line
  },

  error: function (x) {
    'use strict';
    console.error(x); // eslint-disable-line
  },

  /* Merge all direct properties of object 'source' into object 'target'. */
  objectMerge: function (target, source) {
    'use strict';
    var key;
    for (key in source) {
      if (source.hasOwnProperty(key)) {
        target[key] = source[key];
      }
    }
  }
};
