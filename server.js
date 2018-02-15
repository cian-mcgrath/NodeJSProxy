const listenerPort = 20000;//port that the proxy will operate on for http
const host = "127.0.0.1";


const http = require('http'); //import needed functions
const url = require('url');
const net = require('net');
const fs = require('fs');
const readline =  require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

//load in the blacklist
var blockedURLs = JSON.parse(fs.readFileSync("blockedURLs.json"));
//initialise an empty cache, as should not be stored on disk
var cache = {};


/*-------Server Creation--------*/
//create a http server and default request callback function
var proxyServer = http.createServer(onRequest);
//add in connection capabilities for HTTPS
proxyServer.on('connect', onConnect);
// Activates this server, listening on specified port.
proxyServer.listen(listenerPort, host, () => {
	console.log("Proxy online, listening on: " + host + ":" + listenerPort);
});


/*------- Request Handling --------*/
//handles http connections
function onRequest(request, response) {
  var targetUrl = url.parse(request.url,true);

  if(urlBlocked(targetUrl.host)){
    console.log("HTTP request to: " + targetUrl.host + " has been blocked by the proxy.");
    response.writeHead(403);
    response.end("<h1>This domain is being actively blocked by the proxy.<h1>");
  }
  else{
    //log the connection in the server
    console.log('Serving HTTP request to: ' + request.url);
    //create the options for the request the proxy is going to send
    var forwardingOptions = {
      hostname: targetUrl.hostname,
      path: targetUrl.path,
      method: request.method,
      headers: request.headers
    };

    // creates the proxy request, and sends it off.
    // pipes the the readable proxy request through to the writable response of the
    // client. No need for the use of options, as defaults to ending stream, as wanted
    // piping is used to reduce the memory footprint of the proxy, as it doesn't have to
    // buffer the entire request.
    var proxyRequest = http.request(forwardingOptions, (proxyResponse)=>{
      //set the client response to that of the response of the proxy request
      const { statusCode, statusMessage, headers } = proxyResponse;
      response.writeHead(statusCode, statusMessage, headers);
      proxyResponse.pipe(response);
    });
    request.pipe(proxyRequest);
  }
}

/*------- Connection Handling --------*/
// handles HTTPS connections
function onConnect(request, socket, head){
  // parse the domain and port from the url of the request.
  var parsedHostAndPort = request.url.split(':');
  var domainOfHost = parsedHostAndPort[0];
  var port = parseInt(parsedHostAndPort[1]);

  if(urlBlocked(domainOfHost)){
    console.log("HTTPS request to: " + domainOfHost + " has been blocked by the proxy.");
    socket.write("HTTP/" + request.httpVersion + " 403 Forbidden\r\n\r\n");
    socket.end("<h1>This domain is being actively blocked by the proxy.<h1>");
  }
  else{

    console.log('Serving HTTPS request to:', domainOfHost, port);
    var proxySocket = new net.Socket();
    proxySocket.connect(port, domainOfHost, () => {
        proxySocket.write(head);
        //notify the server that the connection has been established
        socket.write('HTTP/' + request.httpVersion + ' 200 Connection Established\r\n' +
                    + 'Proxy-agent: Node.js-Proxy\r\n\r\n');
        // connect pipe output of both sockets so that they can talk to one another
        // it also handles potential errors that arise from the piping of results
        proxySocket.pipe(socket).on('error', () => {
          socket.write("HTTP/" + request.httpVersion + " 500 Connection error\r\n\r\n");
          socket.end();
        });
        socket.pipe(proxySocket).on('error', () => {
          proxySocket.end();
        });
    });
  }
}


/*------- URL Blocking --------*/
// block a url from being accessed
function blockURL(urlToBlock){
  if(urlBlocked(urlToBlock))
    console.log(urlToBlock + " is already blocked.")
  else{
    // add the url to the list of blocked addresses
    blockedURLs[urlToBlock] = true;
    console.log(urlToBlock + " is now blocked.")
  }
}

// unblock a url from being accessed
function unblockURL(urlToUnblock){
  if(urlBlocked(urlToUnblock)){
    //remove the url from the json file
    delete blockedURLs[urlToUnblock];
    console.log(urlToBlock + " is now unblocked.")
  }
  else
    console.log(urlToBlock + " was not blocked.")
}

// writes the list of blocked urls to the file so they can be loaded again.
function updateBlockedUrlFile(){
  fs.writeFile('blockedURLs.json', JSON.stringify(blockedURLs), (err) => {
    	if (err) throw err;
  });
}

function urlBlocked(urlToCheck){
  return blockedURLs[urlToCheck];
}
