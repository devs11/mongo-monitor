"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongodb_1 = require("mongodb");
const https_1 = require("https");
var nconf = require('nconf');
class TelegramNotifyer {
    constructor(bot_enable, bot, key, chatid, url = "https://api.telegram.org") {
        this.bot_enable = bot_enable;
        this.bot = bot;
        this.key = key;
        this.chatid = chatid;
        if (url.charAt(url.length - 1) != "/") {
            url = url + "/";
        }
        this.uri = url;
    }
    send_msg(message) {
        if (this.bot_enable) {
            let botUrl = this.uri + this.bot + ":" + this.key + "/sendMessage?chat_id=" + this.chatid + "&text=" + message;
            try {
                (0, https_1.get)(botUrl);
                Logger.log("Telegram Message dispatched!");
            }
            catch (e) {
                Logger.error("could not send telegram message!");
                Logger.error(e);
            }
        }
    }
}
class MongoDBconnector {
    constructor(configFile, telegramAlert) {
        this.knownCollections = [];
        if (configFile.mongodb.authentication) {
            this.db_url = "mongodb://" + configFile.mongodb.mongodb_username + ":" + configFile.mongodb.mongodb_password + "@" + configFile.mongodb.mongodb_host + ":" + configFile.mongodb.mongodb_port + "?retryWrites=true&w=majority&authSource=" + configFile.mongodb.mongodb_database;
        }
        else {
            this.db_url = "mongodb://" + configFile.mongodb.mongodb_host + ":" + configFile.mongodb.mongodb_port;
        }
        Logger.log("Database URI: " + this.db_url);
        this.db_name = configFile.mongodb.mongodb_database;
        this.telegramAlert = telegramAlert;
        this.mclient = new mongodb_1.MongoClient(this.db_url);
    }
    connect() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.mclient.connect();
            Logger.log("Mongodb connected");
            this.mdb = this.mclient.db(this.db_name);
            this.mclient.on('close', this.retry_connection);
            this.mclient.on('reconnect', this.reconnected);
        });
    }
    disconnect() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.mclient.close();
            Logger.log("Mongodb disconnected");
        });
    }
    retry_connection() {
        Logger.error("Lost Database connection, retrying...");
        this.telegramAlert.send_msg("ERROR with depth_connector_mongo.js websocket!");
    }
    reconnected() {
        Logger.log("MongoDB reconnected, go back to sleep");
        this.telegramAlert.send_msg("MongoDB reconnected");
    }
    getCollectionStats() {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            let status = yield ((_a = this.mdb) === null || _a === void 0 ? void 0 : _a.stats());
            return status;
        });
    }
}
let lastTimeout;
var Logger;
(function (Logger) {
    let configFile;
    function log(msg) {
        if (configFile.general.enable_log) {
            console.log(msg);
        }
    }
    Logger.log = log;
    function error(msg) {
        if (configFile.general.enable_err) {
            console.error(msg);
        }
    }
    Logger.error = error;
    function setConfig(config) {
        configFile = config;
    }
    Logger.setConfig = setConfig;
})(Logger || (Logger = {}));
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        // read config file
        nconf.file({ file: 'mongodb_alert.json' });
        let configFile = nconf.get();
        Logger.setConfig(configFile);
        Logger.log("starting up...");
        var notifier = new TelegramNotifyer(configFile.general.enable_telegram_alert, configFile.telegram.bot_name, configFile.telegram.bot_key, configFile.telegram.chatid);
        let mdb = new MongoDBconnector(configFile, notifier);
        yield mdb.connect();
        let old_stats;
        let default_timeout = configFile.general.default_timeout;
        let timeout_limit = configFile.general.timeout_limit;
        let timeout = default_timeout;
        // check the database for new entries with backoff function
        let checkFunction = function () {
            return __awaiter(this, void 0, void 0, function* () {
                let areThereNoDatabaseUpdates = false;
                try {
                    let stats = yield mdb.getCollectionStats();
                    areThereNoDatabaseUpdates = old_stats && old_stats.objects == stats.objects;
                    if (configFile.general.enable_log) {
                        console.log(`${Date()} object count: ${stats.objects} Check again in ${timeout / 1000} seconds.`);
                    }
                    old_stats = stats;
                }
                catch (ex) {
                    Logger.error(ex);
                    areThereNoDatabaseUpdates = true;
                }
                if (areThereNoDatabaseUpdates) {
                    notifier.send_msg("No Database Update for " + timeout / 1000 + " seconds!\n");
                    if ((timeout * 2) < timeout_limit) {
                        timeout = timeout * 2;
                    }
                    else {
                        timeout = timeout_limit;
                    }
                }
                else {
                    timeout = default_timeout;
                }
                lastTimeout = setTimeout(checkFunction, timeout);
            });
        };
        checkFunction();
        process.on("SIGINT", function () {
            return __awaiter(this, void 0, void 0, function* () {
                Logger.log("Caught SIGINT Signal");
                yield mdb.disconnect();
                if (lastTimeout) {
                    clearTimeout(lastTimeout);
                }
            });
        });
    });
}
main();
