const Promise = require('bluebird')
const AWS = require('aws-sdk')
AWS.config.region = 'us-east-1'
const Kinesis = new AWS.Kinesis()
const uuid = require('uuid/v4')

const sendIt = async (id) => {
  await Kinesis.putRecord({ 
    Data: JSON.stringify({ id: `${id}` }), 
    StreamName: 'kinesis-self-adjusting-dev-Stream-141KNDEDI0VS0', 
    PartitionKey: 'test'}).promise()
}

const start = async () => {
  const prefix = uuid().substring(0, 8)
  let id = 1
  while (true) {
    sendIt(`${prefix}-${id}`)
    id++
    await Promise.delay(10)
  }
}

start()