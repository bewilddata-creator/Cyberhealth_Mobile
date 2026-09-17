// Entry point: registers every screen (Today is already on SCREENS from js/app.js; Task 8 adds
// the rest via Object.assign(SCREENS, {...}) here), then starts the app.
import { start } from "./app.js";
import { adoptApiUrlFromLocation } from "./api.js";

adoptApiUrlFromLocation();
start();
