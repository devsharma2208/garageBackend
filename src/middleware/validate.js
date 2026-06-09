const { validationResult } = require('express-validator');
const { error } = require('../utils/response');

const validate = (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    return error(
      res,
      'Validation failed',
      400,
      result.array().map((e) => ({ field: e.path, message: e.msg }))
    );
  }
  next();
};

module.exports = validate;
