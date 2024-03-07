const io = require('socket.io-client')
const mediaSoupClient = require('mediasoup-client')

const socket = io("/mediasoup")

socket.on('connection-success', (data) => {
    console.log(data)
})


let device;
let rtpCapabilities;
let producerTransport;
let consumerTransport;
let producer;
let consumer;

let params = {
    // mediasoup params
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

const streamSuccess = async (stream) => {
    localVideo.srcObject = stream;

    console.log("Inside the streamSuccess",stream )

    const track  = stream.getVideoTracks()[0];

    params = {
        track,
        ...params
    }
}


const getLocalStream = () => {
    navigator.getUserMedia({
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


const createDevice = async () => {
    try {

        device = new mediaSoupClient.Device();
        console.log('Device created', device);

        await device.load({ routerRtpCapabilities: rtpCapabilities });
        
        console.log('RTP Capabilities', rtpCapabilities);

    } catch (error) {
        console.log(error);

        if (error.name === 'UnsupportedError') {
            console.log('Browser not supported');
        }
    }
}


const getRtpCapabilities = async () => {
    socket.emit('getRtpCapabilities', (data) => {
    console.log('getRtpCapabilities',data)
      rtpCapabilities = data.rtpCapabilities  
    })
}

const createSendTransport = () => {
    socket.emit('createWebRtcTransport', { sender: true }, ({ params }) => {
        if (params.error) {
            console.log('createWebRtcTransport error', params.error);
            return;
        }
        console.log('createWebRtcTransport success', params);

        producerTransport = device.createSendTransport(params);

        producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                // Signal local DTLS parameters to the server
                await socket.emit('transport-connect', {
                    // transportId: producerTransport.id,
                    dtlsParameters,
                });

                // Tell the transport that parameters were transmitted
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


const connectSendTransport = async () => {
    // we now call produce() to instruct the producer transport
    // to send media to the Router
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
    // this action will trigger the 'connect' and 'produce' events above

    console.log("Inside the connectSendTransport", params)

    producer = await producerTransport.produce(params)
  
    producer.on('trackended', () => {
      console.log('track ended')
  
      // close video track
    })
  
    producer.on('transportclose', () => {
      console.log('transport ended')
  
      // close video track
    })
  }


const createRecvTransport = async () => {
    socket.emit('createWebRtcTransport', { sender: false }, ({ params }) => {
        if (params.error) {
            console.log('createWebRtcTransport error', params.error);
            return;
        }

        console.log('createWebRtcTransport success', params);

        consumerTransport = device.createRecvTransport(params);

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
    await socket.emit('consume', {
        rtpCapabilities: device.rtpCapabilities,
    }, async({params}) => {
        if (params.error) {
            console.log('consume error', params.error);
            return;
        }

        console.log('consume success', params);

        consumer = await consumerTransport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters,
        })

        const { track } = consumer;
        const mediaStream = new MediaStream([track]);

        console.log("Inside the connectRecvTransport", mediaStream)

        remoteVideo.srcObject = mediaStream;

        socket.emit('consumer-resume')
    })
}

btnLocalVideo.addEventListener('click', getLocalStream)
btnRtpCapabilities.addEventListener('click', getRtpCapabilities)
btnDevice.addEventListener('click', createDevice)
btnCreateSendTransport.addEventListener('click', createSendTransport)
btnConnectSendTransport.addEventListener('click', connectSendTransport)
btnRecvSendTransport.addEventListener('click', createRecvTransport)
btnConnectRecvTransport.addEventListener('click', connectRecvTransport)