let audioCtx;

function startTest() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const oscillator = audioCtx.createOscillator();
    const panner = audioCtx.createStereoPanner();

    oscillator.type = "sine";
    oscillator.frequency.value = 440;

    oscillator.connect(panner);
    panner.connect(audioCtx.destination);

    oscillator.start();

    let position = -1;
    let direction = 0.02;

    setInterval(() => {
        position += direction;

        if (position >= 1 || position <= -1) {
            direction *= -1;
        }

        panner.pan.value = position;
    }, 50);
}

function playDrop() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const oscillator = audioCtx.createOscillator();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(100, audioCtx.currentTime);

    oscillator.connect(audioCtx.destination);
    oscillator.start();

    setTimeout(() => {
        oscillator.stop();
    }, 500);
}