const io = require('socket.io-client')
const mediaSoupClient = require('mediasoup-client')

const socket = io("/mediasoup")

// Listening on client for connection-success event
socket.on('connection-success', (data) => {
    console.log(data)
})

// Global variables
let device;
let rtpCapabilities;
let producerTransport;
let consumerTransport;
let producer;
let consumer;

let params = {
    // mediasoup params
    // Learn more here: https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/#RtpParameters
    encodings: [
      {
        rid: 'r0',
        maxBitrate: 100000,
        scalabilityMode: 'S1T3',
      },
      {
        rid: 'r1',
        maxBitrate: 300000,
        scalabilityMode: 'S1T3',
      },
      {
        rid: 'r2',
        maxBitrate: 900000,
        scalabilityMode: 'S1T3',
      },
    ],
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
    codecOptions: {
      videoGoogleStartBitrate: 1000
    }
}


// Success callback for getUserMedia
// This callback gets the video tracks and adds them to the params
// It also adds stream to the localVideo
const streamSuccess = async (stream) => {

    localVideo.srcObject = stream;

    console.log("Inside the streamSuccess",stream )

    const track  = stream.getVideoTracks()[0];

    params = {
        track,
        ...params
    }
}

// Step 1:  Get Local Stream
const getLocalStream = async () => {

    // Get user media returns a promise that resolves with a MediaStream
    // It has two callbacks: one for success and one for error
    // https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
    await navigator.getUserMedia({
        audio: false,
        video: {
            width: {
                min: 640,
                max: 1920,
            },
            height: {
                min: 400,
                max: 1080,
            },
        }
    }, streamSuccess, error => {
        console.log('error', error.message)
    })
}

// Step 7: Create Device (For Creating device we need to pass RTP Capabilities)
// So before this get the RTP Capabilities
// From the server 
// Method to create device
const createDevice = async () => {
    try {

        // Create a device
        device = new mediaSoupClient.Device();
        console.log('Device created', device);

        // Device.load basically is like telling the device (Browser in out case)
        // That these are the router configrations you need to prepare for sending and receiving media
        await device.load({ routerRtpCapabilities: rtpCapabilities });
        
        console.log('RTP Capabilities', rtpCapabilities);

    } catch (error) {
        console.log(error);

        if (error.name === 'UnsupportedError') {
            console.log('Browser not supported');
        }
    }
}

// Method to get the RTP Capabilities from the server
// Step 4: Get RTP Capabilities
// This method emits the getRtpCapabilities event
// to the server and expects rtpCapabilities in the callback
const getRtpCapabilities = async () => {
    socket.emit('getRtpCapabilities', (data) => {
    console.log('getRtpCapabilities',data)
      rtpCapabilities = data.rtpCapabilities  
    })
}


// Step 8 : Create Send Transport
const createSendTransport = () => {

    // Emiting the createWebRtcTransport event to the server
    // We are providing the sender as true for indentifying the server that it is the sender
    // Also providing the callback to receive the data
    socket.emit('createWebRtcTransport', { sender: true }, ({ params }) => {
        if (params.error) {
            console.log('createWebRtcTransport error', params.error);
            return;
        }
        console.log('createWebRtcTransport success', params);

        // We actully needs params to create the send transport
        // Thats why we first emitted the createWebRtcTransport to the server and get the params
        // Now we can create the send transport
        producerTransport = device.createSendTransport(params);

        // Once the the producerTransport.produce() is called
        // it will trigger these connect and produce events
        // Once the connect event is emitted we need to emit the transport-connect event
        // To the server
        producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                // Signal local DTLS parameters to the server
                await socket.emit('transport-connect', {
                    // transportId: producerTransport.id,
                    dtlsParameters,
                });

                // Tell the transport that parameters were transmitted or emitted back to the server
                callback();

            } catch (error) {
                errback(error);
            }
        })

        producerTransport.on('produce', async (parameters, callback, errback) => {
            try {
                // Send a request to the server to create a Producer
                await socket.emit('transport-produce', {
                    transportId: producerTransport.id,
                    kind: parameters.kind,
                    rtpParameters: parameters.rtpParameters,
                    appData: parameters.appData,
                }, ({ id }) => {
                    // Tell the transport that parameters were transmitted and provide it with the
                    // server side producer's id.
                    callback({ id })
                })
            } catch (error) {
                errback(error);
            }
        })

    })

}


// This method calls produce methos by passing the pamrams
// The produce method triggers the connect and produce events
const connectSendTransport = async () => {
    // we now call produce() to instruct the producer transport
    // to send media to the Router
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
    // this action will trigger the 'connect' and 'produce' events above

    console.log("Inside the connectSendTransport", params)

    producer = await producerTransport.produce(params)
  
    // Producer events
    producer.on('trackended', () => {
      console.log('track ended')
  
      // close video track
    })
  
    producer.on('transportclose', () => {
      console.log('transport ended')
  
      // close video track
    })
  }

// Method to create Recv Transport
const createRecvTransport = async () => {

    // Emiting the createWebRtcTransport event to the server
    socket.emit('createWebRtcTransport', { sender: false }, ({ params }) => {
        if (params.error) {
            console.log('createWebRtcTransport error', params.error);
            return;
        }

        console.log('createWebRtcTransport success', params);

        // Once we got the params from the server
        // we can create the recv transport
        consumerTransport = device.createRecvTransport(params);

        // This connect will be triggered by the server
        consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                // Signal local DTLS parameters to the server
                await socket.emit('transport-recv-connect', {
                    // transportId: consumerTransport.id,
                    dtlsParameters,
                })

                // Tell the transport that parameters were transmitted
                callback();
            } catch (error) {
                errback(error);
            }
        })
    })
};


const connectRecvTransport = async () => {

    // Emiting the consume event to the server
    await socket.emit('consume', {
        rtpCapabilities: device.rtpCapabilities,
    }, async({params}) => {
        if (params.error) {
            console.log('consume error', params.error);
            return;
        }

        console.log('consume success', params);

        // Once we got the params from the server
        // we can create the recv transport
        consumer = await consumerTransport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters,
        })

        // Getting the track from the consumer
        const { track } = consumer;

        // Adding the track to the remote video
        const mediaStream = new MediaStream([track]);

        console.log("Inside the connectRecvTransport", mediaStream)

        // Attaching the track to the remote video
        remoteVideo.srcObject = mediaStream;

        // Resume the consumer
        socket.emit('consumer-resume')
    })
}


// Event listeners for buttons
btnLocalVideo.addEventListener('click', getLocalStream) // 1: Button to get local Stream
btnRtpCapabilities.addEventListener('click', getRtpCapabilities)
btnDevice.addEventListener('click', createDevice)
btnCreateSendTransport.addEventListener('click', createSendTransport)
btnConnectSendTransport.addEventListener('click', connectSendTransport)
btnRecvSendTransport.addEventListener('click', createRecvTransport)
btnConnectRecvTransport.addEventListener('click', connectRecvTransport)