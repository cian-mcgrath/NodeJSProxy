const listenerPort = 20000; // Port that the proxy will operate on
const host = "127.0.0.1"; // Host of the proxy


const http = require('http'); // Import needed functions
const url = require('url');
const net = require('net');
const fs = require('fs');
const readline =  require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Limit the length of URLs to be printed to the console, so as it is readable.
const maxDisplayableURLLength = 30;

// Load in the list of blocked URLs
var blockedURLs = JSON.parse(fs.readFileSync("blockedURLs.json"));
// Initialise an empty cache for that session
var cache = {};


/*-------Server Creation--------*/
// Create a http server and default request callback function
var proxyServer = http.createServer(onRequest);
// Add in connection capabilities for HTTPS
proxyServer.on('connect', onConnect);
// Activates this server, listening on specified port.
proxyServer.listen(listenerPort, host, () => {
	console.log("Proxy online, listening on:", host + ":" + listenerPort);
  commandPrompt();// allow for the input on a new command
});


/*------- Request Handling --------*/
// Handles http connections
function onRequest(request, response) {
  var targetUrl = url.parse(request.url,true);
  // if the request goes to a blocked url, stop the request and inform them of the
  if(urlBlocked(targetUrl.host)){
    console.log("HTTP request to:", shortenDisplayURL(request.url), "has been blocked by the proxy.");
    response.writeHead(403);
    response.end("<h1>This domain is being actively blocked by the proxy.<h1>");
  }
  else{
    // Attempt to acquire the item from the cache
    var itemInCache = isCachedAndValid(request.url);
    // If the item is successfully retrieved from the cache, serve the data back to the client
    if(itemInCache){
      console.log('HTTP page found in the cache\n. Serving HTTP request to: ' + shortenDisplayURL(request.url) + ' from the cache.');
      const { statusCode, statusMessage, headers, data} = itemInCache;
      response.writeHead(statusCode, statusMessage, headers);
      response.end(data);
    }
    else{
      // Log the connection in the server
      console.log('Serving HTTP request to: ' + shortenDisplayURL(request.url));
      // Create the options for the request the proxy is going to send
      var forwardingOptions = {
        hostname: targetUrl.hostname,
        path: targetUrl.path,
        method: request.method,
        headers: request.headers
      };

      // Creates the proxy request, and sends it off.
      // Pipes the the readable proxy response through to the writable response of the
      // client if it cannot be cached, so as to minimise memory footprint of buffering the
      // response if it were to be cached. If the response is cachable, it is buffered and
      // then added to the cache
      var proxyRequest = http.request(forwardingOptions, (proxyResponse)=>{
        // Set the client response to that of the response of the proxy request
        const { statusCode, statusMessage, headers } = proxyResponse;
        response.writeHead(statusCode, statusMessage, headers);

        // If an item is cacheable, must aquire packets, otherwise it can be piped
        if(isCachable(headers)){
          // Create variable for caching responses to the http request
  	      var data = [];

          proxyResponse.on('error', (err) => {
            console.log("Error with HTTP request", err.stack);
          });

          proxyResponse.on('data', (dataChunk) => {
            data.push(dataChunk);
            response.write(dataChunk);
          });

          proxyResponse.on('end', () => {
            data = Buffer.concat(data);
            addToCache(request.url, statusCode, statusMessage, headers, data);
            response.end();
          });
        }
        else
          proxyResponse.pipe(response);
          // As caching requires viewing of packets, tunneling cannot be used.
          // But if the item is not cacheable, it can be piped.
      });
      request.pipe(proxyRequest);
    }
  }
  commandPrompt(); // Allow for the input on a new command
}

/*------- Connection Handling --------*/
// handles HTTPS connections
function onConnect(request, socket, head){
  // Parse the domain and port from the url of the request.
  var targetUrl = url.parse('https://'+ request.url);
  // If the url is blocked, do not forward the request
  if(urlBlocked(targetUrl.hostname)){
    console.log("HTTPS request to: " + shortenDisplayURL(targetUrl.hostname) + " has been blocked by the proxy.");
    socket.end("HTTP/" + request.httpVersion + " 403 Forbidden\r\n");
  }
  else{
    console.log("Serving HTTPS request to:", shortenDisplayURL(targetUrl.hostname));
    var proxySocket = new net.Socket();
    proxySocket.connect(targetUrl.port, targetUrl.hostname, () => {
        proxySocket.write(head);
        // Notify the client that the connection has been established
        socket.write("HTTP/" + request.httpVersion + " 200 Connection Established\r\n\r\n");
        // Connect pipe output of both sockets so that they can talk to one another
        // it also handles potential errors that arise from the piping of results
        proxySocket.pipe(socket).on('error', (err) => {
          console.log("Error in piping to client\n", err.stack);
        });
        socket.pipe(proxySocket).on('error', (err) => {
          console.log("Error in piping to server\n", err.stack);
        });
    });
  }
  commandPrompt(); // allow for the input on a new command
}


/*------- URL Blocking --------*/
// Block a url from being accessed
function blockURL(urlToBlock){
  if(urlBlocked(urlToBlock))
    console.log(urlToBlock + " is already blocked.")
  else{
    // Add the url to the list of blocked addresses
    blockedURLs[urlToBlock] = true;
    console.log(urlToBlock + " is now blocked.")
  }
}

// Unblock a url from being accessed
function unblockURL(urlToUnblock){
  if(urlBlocked(urlToUnblock)){
    // Remove the url from the json file
    delete blockedURLs[urlToUnblock];
    console.log(urlToUnblock + " is now unblocked.")
  }
  else
    console.log(urlToUnblock + " was not blocked.")
}

// Writes the list of blocked urls to the file so they can be loaded again.
function updateBlockedUrlFile(){
  fs.writeFile('blockedURLs.json', JSON.stringify(blockedURLs), (err) => {
    	if (err) throw err;
  });
}

// Attempts to get the url from the list of blocked URLs,
// which gets evalutated to false in an if statement
function urlBlocked(urlToCheck){
  return blockedURLs[urlToCheck];
}


/*------- Management Console --------*/
// Prompts user for input
function commandPrompt(){
  rl.setPrompt(">");
  rl.prompt();
}

// Reads entered command
rl.on('line', (input) =>{
  var args = input.split(' ');
  // Parse the command entered by the user
  switch(args[0]){

    case "block":
      if(args.length == 2){
        blockURL(args[1]);
        updateBlockedUrlFile();
      }
      else
        console.log("Invalid parameters, please supply only one URL");
      break;

    case "unblock":
      if(args.length == 2){
        unblockURL(args[1]);
        updateBlockedUrlFile();
      }
      else
        console.log("Invalid parameters, please supply only one URL");
      break;

    case "blocklist":
      var blocked = "Blocked URLs are :";
      for (key in blockedURLs)
        blocked += "\n"+ key;
      console.log(blocked);
      break;

    case "clearCache":
      resetCache();
      break;

    case "help":
      help();
      break;

    case "exit":
      proxyServer.close();
      process.exit();
      break;

    default:
      console.log("Unknown command, showing possible commands: ");
      help();
  }
  commandPrompt(); // Allow for the input of sequential commands
});

// Displays the list of usable commands
function help(){
  console.log("Available commands are 'block', 'unblock', 'blocklist', 'clearCache' and  'exit'.")
}

//shortens long urls for display on the console.
function shortenDisplayURL(urlToShorten){
  var updatedDisplayURL = urlToShorten;
  if(updatedDisplayURL.length > maxDisplayableURLLength)
   updatedDisplayURL = updatedDisplayURL.substring(0, maxDisplayableURLLength) + "...";
  return updatedDisplayURL;
}

/*------------------- Caching ---------------------*/
// As HTTPS requests cannot be cached, only HTTP data is stored

// Checks to see if url is in the cache, by attempting to retreive it from the cache
// which is evaluated to false in an if statement
// also validates the item in cache. If invlid, it is removed from the cache
function isCachedAndValid(urlToCheck){
  let item = cache[urlToCheck];
  if(item){
    if(item.expiresAt == null || item.expiresAt < Date.now())
      return item;
    else{
      delete cache[urlToCheck];
      console.log(shortenDisplayURL(urlToCheck), " is out of date in the cache; removed.")
    }
  }
  return null;
}

// Clears the cache
function resetCache(){
  console.log("Cache cleared");
  cache = {};
}

// checks to see if an item is storable in the cache
/*
    Cannot store :
      Cache control : private, no-cache, no-store, max-age=0, must-revalidate
      Pragma: no-cache
*/
function isCachable(headers){
  // Check to see if pragma is set to no-cache,
  // if so, do not add to the cache
  let pragma = headers["pragma"];
  if(pragma)
    if(pragma.includes("no-cache")) return false;

  // Check to see if any cache control directives forbid caching on the server
  let cacheControl =  headers["cache-control"];
  if(cacheControl){
    var cacheDirectives = cacheControl.split(', ');
    for(i in cacheDirectives){
      var directive = cacheDirectives[i];
      if(directive === "no-cache" || directive === "private"||
         directive === "no-store" || directive === "max-age=0" ||
         directive === "must-revalidate"){
        return false;
      }
    }
    return true;
  }
  else return false;
}

// Adds an item to the cache, if it has the needed entries and sets when the item will
// expire, based on the headers provided
function addToCache(urlToCache, statusCode, statusMessage, headers, data){
  if(statusCode && statusMessage && headers && data){
    //adding item to the cache
    cache[urlToCache] = {
      "statusCode": statusCode,
      "statusMessage":statusMessage,
      "headers":headers,
      "data":data,
      "expiresAt":null
    };

    // update expiry to needed values
    let expires = headers["expires"];
    if(expires){
      cache[urlToCache].expiresAt = new Date(expires).getTime();
    }
    else{
      var cacheDirectives = headers["cache-control"].split(', ');
      for(i in cacheDirectives){
        if(cacheDirectives[i].includes("max-age")){
          var timeLeft = cacheDirectives[i].split('=');
          cache[urlToCache].expiresAt = (Date.now() + parseInt(timeLeft[1])*1000);
        }
      }
    }
    console.log( 'Item added to cache: ', shortenDisplayURL(urlToCache));
  }
}
