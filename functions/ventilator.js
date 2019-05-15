const AWS = require('aws-sdk')
const Lambda = new AWS.Lambda()
const DynamoDB = new AWS.DynamoDB.DocumentClient()
const _ = require('lodash')
const debug = require("debug")("ventilator")

const MaxBatchSize = parseInt(process.env.MAX_BATCH_SIZE)
const LatencyThreshold = parseInt(process.env.LATENCY_THRESHOLD)
const EventSourceArn = process.env.KINESIS_ARN
const FunctionName = process.env.AWS_LAMBDA_FUNCTION_NAME
const WorkerFunctionName = process.env.WORKER_FUNCTION_NAME
const TableName = process.env.TABLE_NAME

let eventSourceMapping

const getCurrentDate = () => new Date().toJSON().substr(0, 10)

const getMapping = async () => {
  const listResp = await Lambda.listEventSourceMappings({
    EventSourceArn,
    FunctionName,
    MaxItems: 1,
  }).promise()
  
  const mapping = listResp.EventSourceMappings[0]
  debug(JSON.stringify(mapping))
  const { UUID, BatchSize } = mapping
  return { UUID, BatchSize }
}

const decrementBatchSize = async () => {
  eventSourceMapping = await getMapping()
  if (eventSourceMapping.BatchSize > 1) {
    console.log(`decrementing batch size to ${eventSourceMapping.BatchSize - 1}`)
    await Lambda.updateEventSourceMapping({
      UUID: eventSourceMapping.UUID,
      BatchSize: eventSourceMapping.BatchSize - 1,
      FunctionName,
      Enabled: true
    }).promise()

    eventSourceMapping.BatchSize--
  } else {
    console.log('already at batch size of 1, disabling...')
    await Lambda.updateEventSourceMapping({
      UUID: eventSourceMapping.UUID,
      BatchSize: eventSourceMapping.BatchSize,
      FunctionName,
      Enabled: false
    }).promise()
  }
}

const incrementBatchSize = async () => {
  eventSourceMapping = await getMapping()
  if (eventSourceMapping.BatchSize < MaxBatchSize) {
    console.log(`incrementing batch size to ${eventSourceMapping.BatchSize + 1}`)
    await Lambda.updateEventSourceMapping({
      UUID: eventSourceMapping.UUID,
      BatchSize: eventSourceMapping.BatchSize + 1,
      FunctionName,
      Enabled: true
    }).promise()

    eventSourceMapping.BatchSize++
  }
}

const enableStream = async () => {
  eventSourceMapping = await getMapping()  
  await Lambda.updateEventSourceMapping({
    UUID: eventSourceMapping.UUID,
    BatchSize: eventSourceMapping.BatchSize,
    FunctionName,
    Enabled: true
  }).promise()
}

const doTask = async ({ id }) => {
  const start = Date.now()
  try {
    await Lambda.invoke({
      FunctionName: WorkerFunctionName,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({ id })
    }).promise()
    const end = Date.now()
    return { id, isSuccess: true, latency: end - start }
  } catch (e) {
    console.log(`${id}: task failed.`, e)
    return { id, isSuccess: false }
  }
}

const dedupe = async (tasks) => {
  const req = {
    RequestItems: {
      [TableName]: {
        Keys: tasks.map(({ id }) => ({ 
          Id: `${id}`,
          Date: getCurrentDate()
        }))
      }
    }
  }
  const resp = await DynamoDB.batchGet(req).promise()
  const existingTasks = resp.Responses[TableName]
  return tasks.filter(({ id }) => !existingTasks.some(t => 
    t.Id === `${id}` && (t.IsSuccess || t.Attempts >= 3)))
}

const recordJobStatus = async (results) => {
  const transactItems = results.map(({ id, isSuccess }) => ({
    Update: {
      TableName,
      Key: { Id: `${id}`, Date: getCurrentDate() },
      UpdateExpression: "SET IsSuccess = :IsSuccess ADD Attempts :One",
      ExpressionAttributeValues: {
        ':IsSuccess': isSuccess,
        ':One': 1,
      }
    }
  }))
  const req = {
    TransactItems: transactItems
  }
  await DynamoDB.transactWrite(req).promise()
}

const isPerfDeteriorating = (results) => {
  const slowCount = results.filter(({ latency }) => latency > LatencyThreshold).length
  const errorCount = results.filter(({ isSuccess }) => !isSuccess).length

  debug(`slow tasks: ${slowCount} errors: ${errorCount} total: ${results.length}`)

  return (slowCount + errorCount) / results.length > 0.5
}

const isPerfGood = (results) => {
  const slowCount = results.filter(({ latency }) => latency > LatencyThreshold).length
  const errorCount = results.filter(({ isSuccess }) => !isSuccess).length

  debug(`slow tasks: ${slowCount} errors: ${errorCount} total: ${results.length}`)
  
  return slowCount === 0 && errorCount === 0
}

const containsPartialFailure = (results) => {
  return results.some(({ isSuccess }) => !isSuccess)
}

module.exports.handler = async (event) => {
  debug(JSON.stringify(event))

  if (!eventSourceMapping) {
    eventSourceMapping = await getMapping()
    console.log(`current batch size is ${eventSourceMapping.BatchSize}`)
  }

  // a kinesis event would include Records
  if (event.Records) {
    const tasks = event.Records
      .map(record => {
        const json = Buffer.from(record.kinesis.data, 'base64').toString('utf8')
        return JSON.parse(json)
      })
    const dedupedTasks = await dedupe(tasks)    

    if (_.isEmpty(dedupedTasks)) {
      console.log('nothing to process, moving on...')
      return
    }

    debug(`deduped tasks:\n${JSON.stringify(dedupedTasks)}`)

    // fan out!
    const promises = dedupedTasks.map(doTask)
    const results = await Promise.all(promises)
    debug(JSON.stringify(results, undefined, 2))

    await recordJobStatus(results)
    
    if (isPerfDeteriorating(results)) {
      console.log('performance is deteriorating, reducing batch size')
      await decrementBatchSize()
    } else if (isPerfGood(results) && eventSourceMapping.BatchSize < MaxBatchSize) {
      console.log('performance is good, OK to increase batch size')
      await incrementBatchSize()
    }

    if (containsPartialFailure(results)) {
      // except, to trigger the same batch for reprocessing
      throw new Error('batch contains partial failure')
    }
  } else if (event.source === 'aws.events' && eventSourceMapping.BatchSize < MaxBatchSize) {
    console.log('enabling stream...')
    await enableStream()
  }
}
