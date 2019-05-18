# self-adjusting-kinesis-function-demo

Demo app to illustrate how to write a Lambda function that self-adjusts its batch size to control throughput of Kinesis events

## Getting started

To deploy this project:

1. run `npm install` to restore all dependencies

2. run `npm run deploy`, which would deploy the project using the [Serverless framework](https://serverless.com/framework/).

## What's included in this project

* A `worker` function which lets you control how often it will receive a slow or error response via the environment variables `SLOW_PERCENTAGE` and `ERROR_PERCENTAGE`.

```yml
worker:
  handler: functions/worker.handler
  timeout: 6
  environment:
    SLOW_PERCENTAGE: 10
    ERROR_PERCENTAGE: 10
```

* A `ventilator` function which process data from Kinesis in batches and fans them out to the `worker` function. In addition, it does the following:

  * dedup records against DynamoDB to avoid processing the same record twice.
  * performs retry (up to 3 attempts) by excepting when it encounters partial failures.
  * decrements batch size by 1 if slow + error accounts for over 50% of all tasks.
  * disables the event trigger altogether when reaching batch size of 0.
  * if all tasks were processed quickly and no errors then increment the batch size by 1 at a time, up to the configured max (via the `MAX_BATCH_SIZE` environment variable).
  * cron job (every 10 mins) that re-enables the stream if it was disabled.

* A `feed-stream` script that will continuously write data to the stream. To run the script, run `node feed-stream.js`.