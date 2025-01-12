"use strict";
//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.forceArray = forceArray;
exports.sleep = sleep;
exports.toSQLiteTimestamp = toSQLiteTimestamp;
exports.deepEqual = deepEqual;
exports.sortObject = sortObject;
exports.serialize = serialize;
exports.sha256 = sha256;
exports.makeFingerprint = makeFingerprint;
function forceArray(input) {
    if (Array.isArray(input))
        return input;
    return [input];
}
function sleep(ms) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, new Promise(function (resolve) { return setTimeout(resolve, ms); })];
        });
    });
}
function toSQLiteTimestamp(date) {
    if (!date)
        return null;
    var pad = function (number) { return (number < 10 ? "0" + number : number); };
    var year = date.getUTCFullYear();
    var month = pad(date.getUTCMonth() + 1); // getUTCMonth() returns months from 0-11
    var day = pad(date.getUTCDate());
    var hours = pad(date.getUTCHours());
    var minutes = pad(date.getUTCMinutes());
    var seconds = pad(date.getUTCSeconds());
    return "".concat(year, "-").concat(month, "-").concat(day, " ").concat(hours, ":").concat(minutes, ":").concat(seconds);
}
function deepEqual(a, b) {
    if (a === b) {
        return true;
    }
    if (typeof a !== "object" || typeof b !== "object" || a == null || b == null) {
        return false;
    }
    var keysA = Object.keys(a);
    var keysB = Object.keys(b);
    if (keysA.length !== keysB.length) {
        return false;
    }
    for (var _i = 0, keysA_1 = keysA; _i < keysA_1.length; _i++) {
        var key = keysA_1[_i];
        if (!keysB.includes(key)) {
            return false;
        }
        if (!deepEqual(a[key], b[key])) {
            return false;
        }
    }
    return true;
}
function sortObject(obj) {
    return Object.keys(obj)
        .sort()
        .reduce(function (result, key) {
        result[key] = obj[key];
        return result;
    }, {});
}
function serialize(obj) {
    var sortedObj = sortObject(obj);
    return JSON.stringify(sortedObj);
}
function sha256(data) {
    return __awaiter(this, void 0, void 0, function () {
        var encoder, crypto_1;
        return __generator(this, function (_a) {
            if (typeof window === "object" && window.crypto && window.crypto.subtle) {
                encoder = new TextEncoder();
                return [2 /*return*/, window.crypto.subtle.digest("SHA-256", encoder.encode(data)).then(function (hashBuffer) {
                        var hashArray = Array.from(new Uint8Array(hashBuffer));
                        return hashArray.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
                    })];
            }
            else if (typeof process === "object" && process.versions && process.versions.node) {
                crypto_1 = require("crypto");
                return [2 /*return*/, Promise.resolve(crypto_1.createHash("sha256").update(data).digest("hex"))];
            }
            else {
                throw new Error("Unsupported environment");
            }
            return [2 /*return*/];
        });
    });
}
function makeFingerprint(input) {
    return __awaiter(this, void 0, void 0, function () {
        var serializedObj, hash;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    serializedObj = serialize(input);
                    return [4 /*yield*/, sha256(serializedObj)];
                case 1:
                    hash = _a.sent();
                    return [2 /*return*/, hash];
            }
        });
    });
}
