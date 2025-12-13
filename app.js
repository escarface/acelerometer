// ========================================
// CONFIGURACIÓN Y CONSTANTES
// ========================================

const MAX_DATA_POINTS = 100;
const CALIBRATION_TARGET_REPS = 5;

// ========================================
// CLASES AUXILIARES
// ========================================

// Filtro de promedio móvil para suavizar datos del acelerómetro
class MovingAverageFilter {
    constructor(windowSize = 5) {
        this.windowSize = windowSize;
        this.window = [];
    }

    addValue(value) {
        this.window.push(value);
        if (this.window.length > this.windowSize) {
            this.window.shift();
        }
        return this.getAverage();
    }

    getAverage() {
        if (this.window.length === 0) return 0;
        const sum = this.window.reduce((a, b) => a + b, 0);
        return sum / this.window.length;
    }

    reset() {
        this.window = [];
    }
}

// Registro ligero de datos de sesión
class DataLogger {
    constructor(maxSessions = 10) {
        this.isLogging = false;
        this.current = [];
        this.sessionsKey = 'tt_sessions';
        this.maxSessions = maxSessions;
    }

    start() {
        this.isLogging = true;
        this.current = [];
    }

    stop() {
        this.isLogging = false;
        const session = {
            startedAt: new Date().toISOString(),
            length: this.current.length,
            detectedAxis: detectedAxis,
            calibration: calibratedThresholds ? {
                thresholds: calibratedThresholds,
                date: localStorage.getItem('calibrationDate')
            } : null,
            data: this.current
        };
        try {
            const prev = JSON.parse(localStorage.getItem(this.sessionsKey) || '[]');
            prev.unshift(session);
            if (prev.length > this.maxSessions) prev.length = this.maxSessions;
            localStorage.setItem(this.sessionsKey, JSON.stringify(prev));
            return session;
        } catch (e) {
            console.error('Logger persist error', e);
            return null;
        }
    }

    append(entry) {
        if (!this.isLogging) return;
        this.current.push(entry);
    }

    getSessions() {
        try { return JSON.parse(localStorage.getItem(this.sessionsKey) || '[]'); }
        catch { return []; }
    }

    exportJSON() {
        const blob = new Blob([JSON.stringify(this.getSessions(), null, 2)], { type: 'application/json' });
        this._downloadBlob(blob, `sessions-${Date.now()}.json`);
    }

    exportCSV() {
        const sessions = this.getSessions();
        const headers = ['timestamp','x','y','z','axis','smoothed','cadenceHz','repCount','phase','quality'];
        let lines = [headers.join(',')];
        for (const s of sessions) {
            for (const r of s.data) {
                const row = [r.timestamp,r.x,r.y,r.z,r.axis,r.smoothed,(r.cadenceHz ?? ''),r.repCount,r.phase,(r.quality ?? '')];
                lines.push(row.join(','));
            }
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        this._downloadBlob(blob, `sessions-${Date.now()}.csv`);
    }

    _downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}

// Estimador de frecuencia dominante (cadencia) usando fft.js
// Requiere que exista el global `FFT` (cargado por CDN en index.html)
class FFTCadenceEstimator {
    constructor({ fftSize = 256, sampleRateHz = 30, fMinHz = 0.2, fMaxHz = 5.0, updateEvery = 6, smoothingAlpha = 0.35 } = {}) {
        this.fftSize = fftSize;
        this.sampleRateHz = sampleRateHz;
        this.fMinHz = fMinHz;
        this.fMaxHz = fMaxHz;
        this.updateEvery = Math.max(1, updateEvery);
        this.smoothingAlpha = Math.min(1, Math.max(0, smoothingAlpha));

        this._index = 0;
        this._filled = false;
        this._samplesSeen = 0;
        this._ring = new Float32Array(this.fftSize);
        this._timeDomain = new Float32Array(this.fftSize);
        this._window = this._createHannWindow(this.fftSize);

        this.lastFrequencyHz = 0;
        this.lastPower = 0;

        this._fft = null;
        this._out = null;
        this._fftAvailable = false;
        this._ensureFft();
    }

    _ensureFft() {
        if (this._fft) return;
        try {
            if (typeof FFT === 'undefined') {
                console.warn('FFTCadenceEstimator: FFT (fft.js) no está cargado.');
                this._fftAvailable = false;
                return;
            }
            this._fft = new FFT(this.fftSize);
            this._out = this._fft.createComplexArray();
            this._fftAvailable = true;
        } catch (error) {
            console.error('Error inicializando FFT:', error);
            this._fftAvailable = false;
        }
    }

    _createHannWindow(n) {
        const w = new Float32Array(n);
        if (n <= 1) return w;
        for (let i = 0; i < n; i++) {
            w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
        }
        return w;
    }

    setSampleRate(sampleRateHz) {
        this.sampleRateHz = Math.max(1, sampleRateHz);
    }

    reset() {
        this._index = 0;
        this._filled = false;
        this._samplesSeen = 0;
        this._ring.fill(0);
        this.lastFrequencyHz = 0;
        this.lastPower = 0;
    }

    addSample(value) {
        // Si FFT no está disponible, retornar null silenciosamente
        if (!this._fftAvailable) {
            this._ensureFft(); // Reintentar una vez
            if (!this._fftAvailable) return null;
        }

        this._ring[this._index] = value;
        this._index = (this._index + 1) % this.fftSize;
        if (this._index === 0) this._filled = true;

        this._samplesSeen++;
        if (!this._filled) return null;
        if (!this._fft) return null;
        if (this._samplesSeen % this.updateEvery !== 0) return null;

        // Copiar ring buffer en orden temporal
        for (let i = 0; i < this.fftSize; i++) {
            this._timeDomain[i] = this._ring[(this._index + i) % this.fftSize];
        }

        // Quitar DC y aplicar ventana Hann
        let mean = 0;
        for (let i = 0; i < this.fftSize; i++) mean += this._timeDomain[i];
        mean /= this.fftSize;
        for (let i = 0; i < this.fftSize; i++) {
            this._timeDomain[i] = (this._timeDomain[i] - mean) * this._window[i];
        }

        this._fft.realTransform(this._out, this._timeDomain);

        const binHz = this.sampleRateHz / this.fftSize;
        const kMin = Math.max(1, Math.ceil(this.fMinHz / binHz));
        const kMax = Math.min(Math.floor(this.fftSize / 2), Math.floor(this.fMaxHz / binHz));
        if (kMax <= kMin) return null;

        let bestK = kMin;
        let bestMag2 = -Infinity;
        for (let k = kMin; k <= kMax; k++) {
            const re = this._out[2 * k];
            const im = this._out[2 * k + 1];
            const mag2 = re * re + im * im;
            if (mag2 > bestMag2) {
                bestMag2 = mag2;
                bestK = k;
            }
        }

        const freqHz = bestK * binHz;
        const smoothedHz = this.lastFrequencyHz
            ? (this.smoothingAlpha * freqHz + (1 - this.smoothingAlpha) * this.lastFrequencyHz)
            : freqHz;

        this.lastFrequencyHz = smoothedHz;
        this.lastPower = bestMag2;
        return { frequencyHz: smoothedHz, power: bestMag2 };
    }
}

// Calibrador automático de umbrales
class AutoCalibrator {
    constructor() {
        this.repsData = [];
        this.isCalibrating = false;
        this.repCount = 0;
        this.targetReps = CALIBRATION_TARGET_REPS;
        this.currentRepData = {
            maxZ: -Infinity,
            minZ: Infinity,
            zValues: [],
            startTime: null
        };
        this.state = 'IDLE'; // IDLE, MOVING, COOLDOWN
        this.lastTransitionTime = 0;
    }

    startCalibration() {
        this.isCalibrating = true;
        this.repsData = [];
        this.repCount = 0;
        this.currentRepData = {
            maxZ: -Infinity,
            minZ: Infinity,
            zValues: [],
            startTime: null
        };
        this.state = 'IDLE';
        this.lastTransitionTime = Date.now();
    }

    processValue(z, timestamp) {
        if (!this.isCalibrating) return null;

        const absZ = Math.abs(z);
        
        switch (this.state) {
            case 'IDLE':
                // Detectar inicio de movimiento significativo
                if (absZ > 0.6) {
                    this.state = 'MOVING';
                    this.currentRepData = {
                        maxZ: z,
                        minZ: z,
                        zValues: [z],
                        startTime: timestamp
                    };
                }
                break;

            case 'MOVING':
                // Acumular datos del movimiento
                this.currentRepData.zValues.push(z);
                this.currentRepData.maxZ = Math.max(this.currentRepData.maxZ, z);
                this.currentRepData.minZ = Math.min(this.currentRepData.minZ, z);

                // Detectar fin de movimiento (vuelta a estable)
                if (absZ < 0.3 && this.currentRepData.zValues.length > 15) {
                    const duration = timestamp - this.currentRepData.startTime;
                    const amplitude = this.currentRepData.maxZ - this.currentRepData.minZ;

                    // Validar que sea una repetición válida
                    if (duration >= 500 && duration <= 5000 && amplitude >= 0.8) {
                        this.repsData.push({
                            maxZ: this.currentRepData.maxZ,
                            minZ: this.currentRepData.minZ,
                            amplitude: amplitude,
                            duration: duration,
                            variance: this.calculateVariance(this.currentRepData.zValues)
                        });

                        this.repCount++;
                        console.log(`Calibration rep ${this.repCount}/${this.targetReps} detected - Amplitude: ${amplitude.toFixed(2)}`);

                        if (this.repCount >= this.targetReps) {
                            return this.calculateThresholds();
                        }
                    }

                    this.state = 'COOLDOWN';
                    this.lastTransitionTime = timestamp;
                }
                break;

            case 'COOLDOWN':
                // Esperar 500ms antes de detectar otra rep
                if (timestamp - this.lastTransitionTime > 500) {
                    this.state = 'IDLE';
                }
                break;
        }

        return { repCount: this.repCount, targetReps: this.targetReps };
    }

    calculateVariance(values) {
        if (values.length === 0) return 0;
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
        return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    }

    calculateThresholds() {
        if (this.repsData.length === 0) return null;

        // Calcular estadísticas
        const maxZValues = this.repsData.map(r => r.maxZ);
        const minZValues = this.repsData.map(r => r.minZ);
        const amplitudes = this.repsData.map(r => r.amplitude);

        const avgMaxZ = maxZValues.reduce((a, b) => a + b, 0) / maxZValues.length;
        const avgMinZ = minZValues.reduce((a, b) => a + b, 0) / minZValues.length;
        const avgAmplitude = amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length;

        // Calcular desviación estándar
        const stdMaxZ = Math.sqrt(
            maxZValues.reduce((sum, val) => sum + Math.pow(val - avgMaxZ, 2), 0) / maxZValues.length
        );
        const stdMinZ = Math.sqrt(
            minZValues.reduce((sum, val) => sum + Math.pow(val - avgMinZ, 2), 0) / minZValues.length
        );

        // Crear nuevos umbrales basados en estadísticas (más conservadores)
        const thresholds = {
            upwardAcceleration: Math.max(0.4, avgMaxZ - stdMaxZ * 0.8),
            downwardAcceleration: Math.min(-0.3, avgMinZ + stdMinZ * 0.8),
            minAmplitude: avgAmplitude * 0.6,
            minRepDuration: 700,
            maxRepDuration: 5000,
            stableThreshold: 0.25
        };

        this.isCalibrating = false;

        console.log('Calibration completed:', thresholds);

        return {
            success: true,
            thresholds: thresholds,
            stats: {
                repsDetected: this.repsData.length,
                avgMaxZ,
                avgMinZ,
                avgAmplitude
            }
        };
    }

    stopCalibration() {
        this.isCalibrating = false;
    }

    getProgress() {
        return this.targetReps > 0 ? (this.repCount / this.targetReps) * 100 : 0;
    }
}

// Detector de repeticiones con máquina de estados
class RepDetector {
    constructor(customThresholds = null) {
        this.state = 'IDLE';
        this.repCount = 0;
        this.currentRepStartTime = null;
        this.currentRepData = {
            maxZ: -Infinity,
            minZ: Infinity,
            zValues: [],
            duration: 0
        };

        const defaultThresholds = {
            upwardAcceleration: 0.7,
            downwardAcceleration: -0.5,
            minRepDuration: 700,
            maxRepDuration: 5000,
            stableThreshold: 0.25,
            minAmplitude: 0.9
        };

        this.thresholds = customThresholds ? { ...defaultThresholds, ...customThresholds } : defaultThresholds;
        this.lastQuality = 0;
        this.lastRepTime = 0;
        this.cooldownPeriod = 400;
    }

    setThresholds(thresholds) {
        this.thresholds = { ...this.thresholds, ...thresholds };
        console.log('Thresholds updated:', this.thresholds);
    }

    processAcceleration(z, timestamp) {
        if (this.state !== 'IDLE') {
            this.currentRepData.zValues.push(z);
            this.currentRepData.maxZ = Math.max(this.currentRepData.maxZ, z);
            this.currentRepData.minZ = Math.min(this.currentRepData.minZ, z);
        }

        switch (this.state) {
            case 'IDLE':
                if (z > this.thresholds.upwardAcceleration) {
                    this.state = 'PULLING_UP';
                    this.currentRepStartTime = timestamp;
                    this.currentRepData = {
                        maxZ: z,
                        minZ: z,
                        zValues: [z],
                        duration: 0
                    };
                }
                break;

            case 'PULLING_UP':
                if (z < this.thresholds.stableThreshold && z > this.thresholds.downwardAcceleration) {
                    this.state = 'AT_TOP';
                }
                break;

            case 'AT_TOP':
                if (z < this.thresholds.downwardAcceleration) {
                    this.state = 'LOWERING';
                } else if (z > this.thresholds.upwardAcceleration) {
                    this.state = 'PULLING_UP';
                }
                break;

            case 'LOWERING':
                if (z > this.thresholds.downwardAcceleration && z < this.thresholds.upwardAcceleration) {
                    this.currentRepData.duration = timestamp - this.currentRepStartTime;
                    const timeSinceLastRep = timestamp - this.lastRepTime;
                    const amplitude = this.currentRepData.maxZ - this.currentRepData.minZ;

                    if (this.currentRepData.duration >= this.thresholds.minRepDuration &&
                        this.currentRepData.duration <= this.thresholds.maxRepDuration &&
                        amplitude >= this.thresholds.minAmplitude &&
                        timeSinceLastRep >= this.cooldownPeriod) {
                        this.completeRep(timestamp);
                    }
                    this.state = 'IDLE';
                }
                break;
        }

        return {
            state: this.state,
            repCount: this.repCount,
            quality: this.lastQuality
        };
    }

    completeRep(timestamp) {
        this.repCount++;
        this.lastRepTime = timestamp;
        this.lastQuality = this.calculateRepQuality();
        console.log(`Rep ${this.repCount} completed - Quality: ${this.lastQuality}%`);
        
        this.currentRepData = {
            maxZ: -Infinity,
            minZ: Infinity,
            zValues: [],
            duration: 0
        };
    }

    calculateRepQuality() {
        let quality = 100;
        const duration = this.currentRepData.duration;
        const idealDuration = 2000;
        const durationDiff = Math.abs(duration - idealDuration);

        if (durationDiff > 1000) quality -= 15;
        else if (durationDiff > 500) quality -= 8;

        const range = this.currentRepData.maxZ - this.currentRepData.minZ;
        if (range < 1.0) quality -= 20;
        else if (range < 1.5) quality -= 10;

        if (this.currentRepData.zValues.length > 2) {
            const variance = this.calculateVariance(this.currentRepData.zValues);
            if (variance > 1.5) quality -= 15;
            else if (variance > 0.8) quality -= 8;
        }

        return Math.max(0, Math.min(100, quality));
    }

    calculateVariance(values) {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
        return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    }

    getPhaseText() {
        const phases = {
            'IDLE': 'Listo',
            'PULLING_UP': 'Subiendo',
            'AT_TOP': 'Arriba',
            'LOWERING': 'Bajando'
        };
        return phases[this.state] || 'Listo';
    }

    reset() {
        this.state = 'IDLE';
        this.repCount = 0;
        this.currentRepStartTime = null;
        this.currentRepData = { maxZ: -Infinity, minZ: Infinity, zValues: [], duration: 0 };
        this.lastQuality = 0;
        this.lastRepTime = 0;
    }
}

// ========================================
// ELEMENTOS DEL DOM
// ========================================

const startBtn = document.getElementById('startBtn');
const calibrateBtn = document.getElementById('calibrateBtn');
const xValue = document.getElementById('xValue');
const yValue = document.getElementById('yValue');
const zValue = document.getElementById('zValue');
const status = document.getElementById('status');
const chartCanvas = document.getElementById('chart');
const toggleX = document.getElementById('toggleX');
const toggleY = document.getElementById('toggleY');
const toggleZ = document.getElementById('toggleZ');
const repCountEl = document.getElementById('repCount');
const repPhaseEl = document.getElementById('repPhase');
let cadenceValueEl = null;

// Elementos del panel de calibración
const calibrationPanel = document.getElementById('calibrationPanel');
const calibrationStatus = document.getElementById('calibrationStatus');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const calibrationResults = document.getElementById('calibrationResults');
const thresholdUp = document.getElementById('thresholdUp');
const thresholdDown = document.getElementById('thresholdDown');
const thresholdAmplitude = document.getElementById('thresholdAmplitude');
const closeCalibrateBtn = document.getElementById('closeCalibrateBtn');
const applyCalibrateBtn = document.getElementById('applyCalibrateBtn');

// ========================================
// VARIABLES GLOBALES
// ========================================

let isRunning = false;
let isCalibrating = false;
let chart = null;
let intensityGauge = null;
let qualityGauge = null;
let dataLogger = new DataLogger();
const logStartBtn = document.getElementById('logStartBtn');
const logStopBtn = document.getElementById('logStopBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');

let axisFilter = new MovingAverageFilter(5);
let repDetector = new RepDetector();
let autoCalibrator = new AutoCalibrator();
let detectedAxis = 'y';
let calibratedThresholds = null;

let monitoringStatusBase = '';

let samplingInterval = 33;
let lastSampleTime = 0;

let cadenceEstimator = new FFTCadenceEstimator({
    fftSize: 128,
    sampleRateHz: Math.round(1000 / samplingInterval),
    fMinHz: 0.2,
    fMaxHz: 5.0,
    updateEvery: 4,
    smoothingAlpha: 0.35
});

const dataPoints = {
    labels: [],
    x: [],
    y: [],
    z: []
};

// ========================================
// INICIALIZACIÓN DE GRÁFICAS
// ========================================

function initChart() {
    if (!chartCanvas) {
        console.error('Canvas element not found');
        return;
    }

    const ctx = chartCanvas.getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dataPoints.labels,
            datasets: [
                {
                    label: 'Eje X',
                    data: dataPoints.x,
                    borderColor: '#ff6384',
                    backgroundColor: 'rgba(255, 99, 132, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0
                },
                {
                    label: 'Eje Y',
                    data: dataPoints.y,
                    borderColor: '#36a2eb',
                    backgroundColor: 'rgba(54, 162, 235, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0
                },
                {
                    label: 'Eje Z',
                    data: dataPoints.z,
                    borderColor: '#4bc0c0',
                    backgroundColor: 'rgba(75, 192, 192, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            animation: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            scales: {
                x: {
                    display: false
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'm/s²'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                }
            }
        }
    });
    console.log('Chart initialized');
}

function initIntensityGauge() {
    const gaugeEl = document.querySelector('#intensityGauge');
    if (!gaugeEl) return;

    const options = {
        series: [0],
        chart: {
            type: 'radialBar',
            height: 220,
            sparkline: { enabled: true }
        },
        plotOptions: {
            radialBar: {
                startAngle: -90,
                endAngle: 90,
                track: {
                    background: '#e7e7e7',
                    strokeWidth: '97%',
                    margin: 5,
                    dropShadow: {
                        enabled: true,
                        top: 2,
                        left: 0,
                        color: '#999',
                        opacity: 1,
                        blur: 2
                    }
                },
                dataLabels: {
                    name: { show: false },
                    value: {
                        offsetY: -2,
                        fontSize: '22px',
                        formatter: function(val) {
                            return parseInt(val);
                        }
                    }
                }
            }
        },
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'light',
                type: 'horizontal',
                shadeIntensity: 0.4,
                gradientToColors: ['#FF6384'],
                inverseColors: false,
                opacityFrom: 1,
                opacityTo: 1,
                stops: [0, 50, 100]
            }
        },
        labels: ['Intensidad']
    };

    intensityGauge = new ApexCharts(gaugeEl, options);
    intensityGauge.render();
}

function initQualityGauge() {
    const gaugeEl = document.querySelector('#qualityGauge');
    if (!gaugeEl) return;

    const options = {
        series: [0],
        chart: {
            type: 'radialBar',
            height: 220,
            sparkline: { enabled: true }
        },
        plotOptions: {
            radialBar: {
                startAngle: -90,
                endAngle: 90,
                track: {
                    background: '#e7e7e7',
                    strokeWidth: '97%',
                    margin: 5,
                    dropShadow: {
                        enabled: true,
                        top: 2,
                        left: 0,
                        color: '#999',
                        opacity: 1,
                        blur: 2
                    }
                },
                dataLabels: {
                    name: { show: false },
                    value: {
                        offsetY: -2,
                        fontSize: '22px',
                        formatter: function(val) {
                            return parseInt(val) + '%';
                        }
                    }
                }
            }
        },
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'light',
                type: 'horizontal',
                shadeIntensity: 0.4,
                gradientToColors: ['#4BC0C0'],
                inverseColors: false,
                opacityFrom: 1,
                opacityTo: 1,
                stops: [0, 50, 100]
            }
        },
        labels: ['Calidad']
    };

    qualityGauge = new ApexCharts(gaugeEl, options);
    qualityGauge.render();
}

// ========================================
// FUNCIONES DE ACTUALIZACIÓN
// ========================================

function updateChart(x, y, z) {
    const timestamp = dataPoints.labels.length;

    dataPoints.labels.push(timestamp);
    dataPoints.x.push(x);
    dataPoints.y.push(y);
    dataPoints.z.push(z);

    if (dataPoints.labels.length > MAX_DATA_POINTS) {
        dataPoints.labels.shift();
        dataPoints.x.shift();
        dataPoints.y.shift();
        dataPoints.z.shift();
    }

    if (chart) {
        chart.update('none');
    }
}

function toggleAxisVisibility(axisIndex, isVisible) {
    if (chart) {
        chart.data.datasets[axisIndex].hidden = !isVisible;
        chart.update();
    }
}

function updateValues(x, y, z) {
    xValue.textContent = x.toFixed(2);
    yValue.textContent = y.toFixed(2);
    zValue.textContent = z.toFixed(2);
}

function updateRepCounter(count) {
    const prevCount = parseInt(repCountEl.textContent);
    if (count > prevCount) {
        repCountEl.classList.add('pulse');
        setTimeout(() => repCountEl.classList.remove('pulse'), 400);
    }
    repCountEl.textContent = count;
}

function updatePhase(phase) {
    repPhaseEl.textContent = phase;
}

function updateIntensityGauge(axisValue) {
    if (!intensityGauge) return;
    const absValue = Math.abs(axisValue);
    const percentage = Math.min(100, (absValue / 3) * 100);
    intensityGauge.updateSeries([percentage]);
}

function updateQualityGauge(quality) {
    if (!qualityGauge) return;
    qualityGauge.updateSeries([quality]);
}

// ========================================
// CALIBRACIÓN
// ========================================

function showCalibrationPanel() {
    calibrationPanel.classList.remove('hidden');
}

function hideCalibrationPanel() {
    calibrationPanel.classList.add('hidden');
}

function updateCalibrationProgress() {
    const progress = autoCalibrator.getProgress();
    progressBar.style.width = progress + '%';
    const repsDetected = autoCalibrator.repCount;
    const repsTarget = autoCalibrator.targetReps;
    progressText.textContent = `Repetición ${repsDetected}/${repsTarget}`;
}

async function startCalibration() {
    if (!window.DeviceMotionEvent) {
        status.textContent = 'Tu dispositivo no soporta el acelerómetro';
        status.className = 'status error';
        return;
    }

    const hasPermission = await requestPermission();
    if (!hasPermission) return;

    status.textContent = 'Detectando orientación...';
    status.className = 'status';
    detectedAxis = await detectVerticalAxis(status);

    showCalibrationPanel();
    calibrationStatus.textContent = 'Realiza 5 repeticiones completas y controladas. La calibración comenzará automáticamente.';
    progressText.textContent = 'Esperando inicio...';
    progressBar.style.width = '0%';
    calibrationResults.classList.add('hidden');
    applyCalibrateBtn.classList.add('hidden');

    autoCalibrator.startCalibration();
    axisFilter.reset();
    cadenceEstimator.reset();
    if (cadenceValueEl) cadenceValueEl.textContent = '--';
    dataPoints.labels = [];
    dataPoints.x = [];
    dataPoints.y = [];
    dataPoints.z = [];

    isCalibrating = true;
    isRunning = true;
    startBtn.textContent = 'Detener Calibración';
    startBtn.classList.add('active');

    console.log('Starting calibration...');
    window.addEventListener('devicemotion', handleMotionCalibration);
}

function handleMotionCalibration(event) {
    if (!isCalibrating) return;

    const now = Date.now();
    if (now - lastSampleTime < samplingInterval) return;
    lastSampleTime = now;

    const acc = event.acceleration || event.accelerationIncludingGravity;
    if (!acc || (acc.x === null && acc.y === null && acc.z === null)) return;

    const x = acc.x || 0;
    const y = acc.y || 0;
    const z = acc.z || 0;

    updateChart(x, y, z);
    updateValues(x, y, z);

    let axisValue;
    switch(detectedAxis) {
        case 'x': axisValue = x; break;
        case 'y': axisValue = y; break;
        case 'z': axisValue = z; break;
        default: axisValue = y;
    }

    const smoothed = axisFilter.addValue(axisValue);
    const result = autoCalibrator.processValue(smoothed, now);

    if (result && result.repCount !== undefined) {
        updateCalibrationProgress();

        if (result.thresholds) {
            completeCalibration(result);
        }
    }
}

function completeCalibration(result) {
    isCalibrating = false;
    isRunning = false;
    window.removeEventListener('devicemotion', handleMotionCalibration);

    calibratedThresholds = result.thresholds;
    localStorage.setItem('calibratedThresholds', JSON.stringify(calibratedThresholds));
    localStorage.setItem('calibrationDate', new Date().toISOString());

    calibrationStatus.textContent = '✓ ¡Calibración completada!';
    progressBar.style.width = '100%';
    progressText.textContent = `${result.stats.repsDetected} repeticiones analizadas`;

    thresholdUp.textContent = result.thresholds.upwardAcceleration.toFixed(2) + ' m/s²';
    thresholdDown.textContent = result.thresholds.downwardAcceleration.toFixed(2) + ' m/s²';
    thresholdAmplitude.textContent = result.thresholds.minAmplitude.toFixed(2) + ' m/s²';

    calibrationResults.classList.remove('hidden');
    applyCalibrateBtn.classList.remove('hidden');

    startBtn.textContent = 'Iniciar';
    startBtn.classList.remove('active');
}

// ========================================
// DETECCIÓN Y MONITOREO
// ========================================

function handleMotion(event) {
    if (!isRunning || isCalibrating) return;

    const now = Date.now();
    if (now - lastSampleTime < samplingInterval) return;
    lastSampleTime = now;

    const acc = event.acceleration || event.accelerationIncludingGravity;
    if (!acc || (acc.x === null && acc.y === null && acc.z === null)) return;

    const x = acc.x || 0;
    const y = acc.y || 0;
    const z = acc.z || 0;

    updateValues(x, y, z);
    updateChart(x, y, z);

    let axisValue;
    switch(detectedAxis) {
        case 'x': axisValue = x; break;
        case 'y': axisValue = y; break;
        case 'z': axisValue = z; break;
        default: axisValue = y;
    }

    const smoothed = axisFilter.addValue(axisValue);

    // Estimar cadencia por FFT (mostrar en campo fijo)
    try {
        const cadence = cadenceEstimator.addSample(smoothed);
        if (cadence && cadenceValueEl) {
            const rpm = cadence.frequencyHz * 60;
            cadenceValueEl.textContent = rpm.toFixed(0);
        }
    } catch (error) {
        console.error('Error en cadenceEstimator:', error);
    }

    const repResult = repDetector.processAcceleration(smoothed, now);

    updateRepCounter(repResult.repCount);
    updatePhase(repDetector.getPhaseText());
    updateIntensityGauge(smoothed);

    if (repResult.quality > 0) {
        updateQualityGauge(repResult.quality);
    }

    // Logging
    dataLogger.append({
        timestamp: now,
        x, y, z,
        axis: detectedAxis,
        smoothed,
        cadenceHz: cadenceEstimator.lastFrequencyHz || null,
        repCount: repResult.repCount,
        phase: repDetector.getPhaseText(),
        quality: repResult.quality || null
    });
}

function detectVerticalAxis(statusElement) {
    return new Promise((resolve) => {
        let samplesCollected = 0;
        const samples = { x: [], y: [], z: [] };
        const SAMPLES_NEEDED = 5;

        const handler = (event) => {
            const acc = event.accelerationIncludingGravity;
            if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

            samples.x.push(Math.abs(acc.x));
            samples.y.push(Math.abs(acc.y));
            samples.z.push(Math.abs(acc.z));
            samplesCollected++;

            statusElement.textContent = `Detectando... (${samplesCollected}/${SAMPLES_NEEDED})`;

            if (samplesCollected >= SAMPLES_NEEDED) {
                const avgX = samples.x.reduce((a, b) => a + b, 0) / SAMPLES_NEEDED;
                const avgY = samples.y.reduce((a, b) => a + b, 0) / SAMPLES_NEEDED;
                const avgZ = samples.z.reduce((a, b) => a + b, 0) / SAMPLES_NEEDED;

                let verticalAxis;
                if (avgX >= avgY && avgX >= avgZ) verticalAxis = 'x';
                else if (avgY >= avgX && avgY >= avgZ) verticalAxis = 'y';
                else verticalAxis = 'z';

                console.log(`Vertical axis detected: ${verticalAxis.toUpperCase()} (X:${avgX.toFixed(2)}, Y:${avgY.toFixed(2)}, Z:${avgZ.toFixed(2)})`);

                window.removeEventListener('devicemotion', handler);
                resolve(verticalAxis);
            }
        };

        window.addEventListener('devicemotion', handler);

        setTimeout(() => {
            window.removeEventListener('devicemotion', handler);
            console.log('Timeout - using Y as default');
            resolve('y');
        }, 2000);
    });
}

async function requestPermission() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
            const permission = await DeviceMotionEvent.requestPermission();
            if (permission === 'granted') {
                return true;
            } else {
                status.textContent = 'Permiso denegado';
                status.className = 'status error';
                return false;
            }
        } catch (error) {
            console.error('Error requesting permission:', error);
            status.textContent = 'Error al solicitar permisos: ' + error.message;
            status.className = 'status error';
            return false;
        }
    }
    return true;
}

async function toggleMonitoring() {
    if (!isRunning) {
        if (!window.DeviceMotionEvent) {
            status.textContent = 'Tu dispositivo no soporta el acelerómetro';
            status.className = 'status error';
            return;
        }

        const hasPermission = await requestPermission();
        if (!hasPermission) return;

        status.textContent = 'Detectando orientación...';
        status.className = 'status';
        detectedAxis = await detectVerticalAxis(status);

        status.textContent = `Eje detectado: ${detectedAxis.toUpperCase()} ✓`;
        status.className = 'status success';

        await new Promise(resolve => setTimeout(resolve, 1500));

        axisFilter.reset();
        repDetector.reset();
        cadenceEstimator.reset();
        cadenceEstimator.setSampleRate(Math.round(1000 / samplingInterval));
        if (cadenceValueEl) cadenceValueEl.textContent = '--';

        if (calibratedThresholds) {
            repDetector.setThresholds(calibratedThresholds);
            monitoringStatusBase = `Monitoreando con calibración (Eje ${detectedAxis.toUpperCase()})`;
            status.textContent = monitoringStatusBase;
        } else {
            monitoringStatusBase = `Monitoreando (Eje ${detectedAxis.toUpperCase()})`;
            status.textContent = monitoringStatusBase;
        }

        updateRepCounter(0);
        updatePhase('Listo');
        updateQualityGauge(0);

        isRunning = true;
        startBtn.textContent = 'Detener';
        startBtn.classList.add('active');
        status.className = 'status success';

        window.addEventListener('devicemotion', handleMotion);
    } else {
        isRunning = false;
        monitoringStatusBase = '';
        startBtn.textContent = 'Iniciar';
        startBtn.classList.remove('active');
        status.textContent = 'Detenido';
        status.className = 'status';

        if (cadenceValueEl) cadenceValueEl.textContent = '--';

        window.removeEventListener('devicemotion', handleMotion);
    }
}

// ========================================
// INICIALIZACIÓN
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    // Obtener referencia al elemento de cadencia (puede no existir en versiones antiguas)
    cadenceValueEl = document.getElementById('cadenceValue');
    
    // Cargar umbrales calibrados
    const savedThresholds = localStorage.getItem('calibratedThresholds');
    if (savedThresholds) {
        try {
            calibratedThresholds = JSON.parse(savedThresholds);
            const calibrationDate = localStorage.getItem('calibrationDate');
            console.log('Calibrated thresholds loaded. Date:', calibrationDate);
            status.textContent = '✓ Calibración cargada';
            status.className = 'status success';
        } catch (e) {
            console.error('Error loading thresholds:', e);
        }
    }

    // Inicializar gráficas
    initChart();
    initIntensityGauge();
    initQualityGauge();

    // Control de frecuencia
    const samplingRateSlider = document.getElementById('samplingRate');
    const samplingRateValueEl = document.getElementById('samplingRateValue');

    // Event listeners
    startBtn.addEventListener('click', toggleMonitoring);
    calibrateBtn.addEventListener('click', startCalibration);

    if (logStartBtn) logStartBtn.addEventListener('click', () => {
        dataLogger.start();
        status.textContent = 'Registro iniciado';
    });
    if (logStopBtn) logStopBtn.addEventListener('click', () => {
        const session = dataLogger.stop();
        status.textContent = session ? `Registro guardado (${session.length} muestras)` : 'Registro detenido';
    });
    if (exportJsonBtn) exportJsonBtn.addEventListener('click', () => dataLogger.exportJSON());
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => dataLogger.exportCSV());

    closeCalibrateBtn.addEventListener('click', () => {
        isCalibrating = false;
        isRunning = false;
        window.removeEventListener('devicemotion', handleMotionCalibration);
        hideCalibrationPanel();
        startBtn.textContent = 'Iniciar';
        startBtn.classList.remove('active');
        status.textContent = 'Calibración cancelada';
        status.className = 'status';

        if (cadenceValueEl) cadenceValueEl.textContent = '--';
    });

    applyCalibrateBtn.addEventListener('click', () => {
        hideCalibrationPanel();
        status.textContent = 'Calibración aplicada. Presiona Iniciar.';
        status.className = 'status success';
    });

    toggleX.addEventListener('change', (e) => toggleAxisVisibility(0, e.target.checked));
    toggleY.addEventListener('change', (e) => toggleAxisVisibility(1, e.target.checked));
    toggleZ.addEventListener('change', (e) => toggleAxisVisibility(2, e.target.checked));

    samplingRateSlider.addEventListener('input', (e) => {
        const hz = parseInt(e.target.value);
        samplingInterval = 1000 / hz;
        samplingRateValueEl.textContent = hz + ' Hz';

        cadenceEstimator.setSampleRate(hz);
    });

    // Registrar Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .then(() => console.log('Service Worker registered'))
            .catch(err => console.error('Service Worker error:', err));
    }

    console.log('Training Tracker initialized');
});
