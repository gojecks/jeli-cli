'use strict';
const connect = require('connect');
const http = require('http');
const serverSetup = require('./setup');
const { WebSocketServer } = require('ws');

class HttpServer {
    socketClients = [];
    constructor(options) {
        const app = connect();
        if (options.before && options.before.length) {
            options.before.forEach(m => app.use(m));
        }
        serverSetup(options, app);
        this.server = http.createServer(app);
        if (options.timeout !== undefined) {
            this.server.setTimeout(options.timeout);
        }

        if (options.enableSocket) {
            const wss = new WebSocketServer({ noServer: true });

            // heartbeat - detect and remove stale connections every 30 s
            const heartbeat = setInterval(() => {
                wss.clients.forEach(ws => {
                    if (!ws.isAlive) {
                        this.socketClients = this.socketClients.filter(c => c !== ws);
                        return ws.terminate();
                    }
                    ws.isAlive = false;
                    ws.ping();
                });
            }, 30000);

            wss.on('close', () => clearInterval(heartbeat));

            this.server.on('upgrade', (request, socket, head) => {
                wss.handleUpgrade(request, socket, head, ws => {
                    ws.isAlive = true;
                    ws.on('pong', () => { ws.isAlive = true; });
                    ws.on('close', () => {
                        this.socketClients = this.socketClients.filter(c => c !== ws);
                    });
                    this.socketClients.push(ws);
                });
            });
        }
    }

    pushEvent(msg){
        this.socketClients.forEach(ws => {
            if (ws.readyState === ws.OPEN) ws.send(msg);
        });
    }

    close() {
        this.socketClients.forEach(ws => ws.terminate());
        this.socketClients.length = 0;
        return this.server.close();
    }

    listen() {
        this.server.listen.apply(this.server, arguments);
    }
}


module.exports = options => new HttpServer(options);