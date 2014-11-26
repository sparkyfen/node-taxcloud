var taxCloud = require('./index');
var uuid = require('node-uuid');
var apiKey = 'NXNXNXNXN-XNXN-XNXN-XNXN-XNXNXNXNXNXN';
var apiLoginId = 'XXXXXXXX';
var uspsUserID = 'NNNXXXXNNNN';

// Initialize taxcloud object with keys and ids.
taxCloud.initialize(apiLoginId, apiKey, uspsUserID);

// Ping Taxcloud to verify account information.
taxCloud.ping(function (error, result) {
  if(error){
    console.log(error);
  }
  // Should be true or false
  console.log(result);
});

// Retreive tax information between two locations.
taxCloud.lookup(uuid.v4(), {
  id: uuid.v4(),
  items: [{
    id: uuid.v4(),
    tic: '00000',
    price: 18.00,
    quantity: 1
  }, {
    id: uuid.v4(),
    tic: '00000',
    price: 26.00,
    quantity: 1
  }]
}, {
  address1: 'NNN N CENTRAL AVE',
  address2: null,
  city: 'MyCity',
  state: 'XX',
  zipcode: 'NNNNN-NNNN',
}, {
  address1: 'NNN N GALVIN PKWY',
  address2: null,
  city: 'MyCity',
  state: 'XX',
  zipcode: 'XXXXX-XXXX'
}, function (error, data) {
  if(error) {
    return console.log(error);
  }
  console.log(data);
});

// Authorize an order
taxCloud.authorize(uuid.v4(), uuid.v4(), uuid.v4(), '2014-11-26T13:39:15', function (error, result) {
  if(error) {
    return console.log(error);
  }
  // Should be true or false
  console.log(result);
});

// Complete an transaction.
taxCloud.capture(uuid.v4(), function (error, result) {
  if(error) {
    return console.log(error);
  }
  // Should be true or false
  console.log(result);
});

// Verify valid addresses via USPS.
taxCloud.verifyAddress({
  address1: 'NNN N GALVIN PKWY',
  address2: null,
  city: 'MyCity',
  state: 'XX',
  zipcode: 'XXXXX-XXXX'
}, function (error, result) {
  if(error) {
    return console.log(error);
  }
  console.log(result);
});

// Get Taxability Information Codes object (TICs)
taxCloud.getTics(function (error, tics) {
  if(error) {
    return console.log(error);
  }
  console.log(tics);
});

// Just get the list of TICs values with no description.
taxCloud.getTicList(function (error, ticList) {
  if(error) {
    return console.log(error);
  }
  console.log(ticList);
});