const io = require('socket.io-client')
const mediaSoupClient = require('mediasoup-client')

const socket = io("/mediasoup")

socket.on('connection-success', ({ socketId, existsProducer}) => {
    console.log("Inside the connection-success", socketId, existsProducer)
})


let device;
let rtpCapabilities;
let producerTransport;
let consumerTransport;
let producer;
let consumer;
let isProducer = false;

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

const streamSuccess = (stream) => {
    localVideo.srcObject = stream;

    console.log("Inside the streamSuccess",stream )

    const track  = stream.getVideoTracks()[0];

    params = {
        track,
        ...params
    }

    goConnect(true);
}


const getLocalStream = () => {
    navigator.mediaDevices.getUserMedia({
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
    })
    .then(streamSuccess)
    .catch(err => console.log(err.message))
}

const goConsume = () => {
    goConnect(false);
}

const goConnect = (producerOrConsumer) => {
    isProducer = producerOrConsumer;
    device === undefined ? getRtpCapabilities() : goCreateTransport()
}

const goCreateTransport = () => {
    isProducer ? createSendTransport() : createRecvTransport();
}

const createDevice = async () => {
    try {

        device = new mediaSoupClient.Device();
        console.log('Device created', device);
        console.log(rtpCapabilities)

        await device.load({ routerRtpCapabilities: rtpCapabilities });
        
        console.log('Device RTP Capabilities', rtpCapabilities);

        goCreateTransport();

    } catch (error) {
        console.log(error);

        if (error.name === 'UnsupportedError') {
            console.log('Browser not supported');
        }
    }
}


const getRtpCapabilities = () => {
    socket.emit('createRoom', (data) => {

    console.log('getRtpCapabilities',data)

      rtpCapabilities = data.rtpCapabilities  
      createDevice();
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

        connectSendTransport();

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

        connectRecvTransport();
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
btnRecvSendTransport.addEventListener('click', goConsume)