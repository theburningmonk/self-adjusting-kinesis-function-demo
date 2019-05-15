const Promise = require('bluebird')
const AWS = require('aws-sdk')
AWS.config.region = 'us-east-1'
const Kinesis = new AWS.Kinesis()

const sendIt = async (id) => {
  await Kinesis.putRecord({ 
    Data: JSON.stringify({ id: `${id}` }), 
    StreamName: 'kinesis-self-adjusting-dev-Stream-141KNDEDI0VS0', 
    PartitionKey: 'test'}).promise()
}

const start = async () => {
  let id = 1
  while (true) {
    sendIt(id)
    id++
    await Promise.delay(10)
  }
}

start()