# mongo-monitor

Application to monitor mongodb Database and Alert via Telegram Bot when no new data entries are made while a spesific time period (backoff function is in place so you do not get spammed too hard). 

Ideal for monitoring live data capturing processes to make sure they do not crash or have any other problems. 

## Setup

Copy the `mongo-monitor.json_sample` to `mongodb_alert.json` and edit the file according to the configuration of your database.
Run `npm install` to install dependencies. 
To execute the program, run `tsc; node mongo-monitor`. 