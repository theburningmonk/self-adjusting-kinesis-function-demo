const Promise = require('bluebird')

const { SLOW_PERCENTAGE, ERROR_PERCENTAGE } = process.env
const slowProbability = parseInt(SLOW_PERCENTAGE) / 100.0
const errorProbability = parseInt(ERROR_PERCENTAGE) / 100.0

module.exports.handler = async () => {
  if (Math.random() <= slowProbability) {
    await Promise.delay(2000)
  } else if (Math.random() <= errorProbability) {
    throw new Error('boom!')
  }

  return {
    status: 200,
    body: JSON.stringify({
      message: 'chaos is a ladder'
    })
  }
}