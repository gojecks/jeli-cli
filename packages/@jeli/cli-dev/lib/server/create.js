'use strict';
const connect = require('connect');
const http = require('http');
const serverSetup = require('./setup');
const WebSocket = require('faye-websocket');
/**
 * Constructor function for the HttpServer object
 * which is responsible for serving static files along
 * with other HTTP-related features.
 */
function HttpServer(options) {
    let socketClients = [];
    const app = connect();
    if (options.before && options.before.length){
        options.before.forEach(app.use);
    }
    // set up the sever configs
    serverSetup(options, app);
    this.server = http.createServer(app);
    if (options.timeout !== undefined) {
        this.server.setTimeout(options.timeout);
    }

    if (options.enableSocket) {
        this.server.addListener('upgrade', (request, socket, body) => {
            let ws = new WebSocket(request, socket, body);
            ws.on('close', function(event) {
                socketClients = socketClients.filter(client => client !== ws);
                ws = null;
            });

            socketClients.push(ws);
        });
    }

    this.pushEvent = msg => {
        socketClients.forEach(ws => ws.send(msg));
    };

    this.close = function() {
        socketClients.length = 0;
        return this.server.close();
    };
}

HttpServer.prototype.listen = function() {
    this.server.listen.apply(this.server, arguments);
};

module.exports = options => {
    return new HttpServer(options);
};