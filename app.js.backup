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

// Calibrador automático de umbrales
class AutoCalibrator {
    constructor() {
        this.repsData = [];
        this.isCalibrating = false;
        this.repCount = 0;
        this.targetReps = 5;
        this.currentRepPeaks = {
            maxZ: -Infinity,
            minZ: Infinity,
            zValues: []
        };
        this.inRep = false;
    }

    startCalibration(targetReps = 5) {
        this.isCalibrating = true;
        this.repsData = [];
        this.repCount = 0;
        this.targetReps = targetReps;
        this.currentRepPeaks = {
            maxZ: -Infinity,
            minZ: Infinity,
            zValues: []
        };
        this.inRep = false;
    }

    processValue(z) {
        if (!this.isCalibrating) return null;

        // Detectar si estamos en una repetición (movimiento significativo)
        if (Math.abs(z) > 0.5 && !this.inRep) {
            this.inRep = true;
            this.currentRepPeaks = {
                maxZ: z,
                minZ: z,
                zValues: [z]
            };
        } else if (this.inRep) {
            this.currentRepPeaks.zValues.push(z);
            this.currentRepPeaks.maxZ = Math.max(this.currentRepPeaks.maxZ, z);
            this.currentRepPeaks.minZ = Math.min(this.currentRepPeaks.minZ, z);

            // Detectar fin de repetición (vuelta a estable)
            if (Math.abs(z) < 0.2 && this.currentRepPeaks.zValues.length > 20) {
                this.repsData.push({
                    maxZ: this.currentRepPeaks.maxZ,
                    minZ: this.currentRepPeaks.minZ,
                    amplitude: this.currentRepPeaks.maxZ - this.currentRepPeaks.minZ,
                    variance: this.calculateVariance(this.currentRepPeaks.zValues)
                });

                this.repCount++;
                this.inRep = false;

                if (this.repCount >= this.targetReps) {
                    return this.calculateThresholds();
                }

                return { repCount: this.repCount, targetReps: this.targetReps };
            }
        } else if (Math.abs(z) < 0.2) {
            // Mantener estable
            this.inRep = false;
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

        // Crear nuevos umbrales basados en estadísticas
        const thresholds = {
            upwardAcceleration: Math.max(0.5, avgMaxZ - stdMaxZ * 0.5),
            downwardAcceleration: Math.min(-0.3, avgMinZ + stdMinZ * 0.5),
            minAmplitude: avgAmplitude * 0.7, // 70% de amplitud promedio
            minRepDuration: 600,
            maxRepDuration: 5000,
            stableThreshold: 0.25
        };

        this.isCalibrating = false;

        return {
            success: true,
            thresholds: thresholds,
            stats: {
                repsDetected: this.repsData.length,
                avgMaxZ,
                avgMinZ,
                avgAmplitude,
                stdMaxZ,
                stdMinZ
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
        this.state = 'IDLE'; // IDLE, PULLING_UP, AT_TOP, LOWERING
        this.repCount = 0;
        this.currentRepStartTime = null;
        this.currentRepData = {
            maxZ: -Infinity,
            minZ: Infinity,
            zValues: [],
            duration: 0
        };

        // Umbrales por defecto
        const defaultThresholds = {
            upwardAcceleration: 0.8,      // m/s² para detectar inicio de subida
            downwardAcceleration: -0.6,   // m/s² para detectar inicio de bajada
            minPeakValue: 0.4,            // valor mínimo en el pico
            minRepDuration: 800,          // ms - duración mínima de una rep
            maxRepDuration: 5000,         // ms - duración máxima de una rep
            stableThreshold: 0.3,         // umbral para considerar posición estable
            minAmplitude: 1.0             // amplitud mínima
        };

        // Usar umbrales personalizados si se proporcionan
        this.thresholds = customThresholds ? { ...defaultThresholds, ...customThresholds } : defaultThresholds;

        this.lastQuality = 0;
        this.lastRepTime = 0;
        this.cooldownPeriod = 300; // ms entre reps para evitar duplicados
    }

    setThresholds(thresholds) {
        this.thresholds = { ...this.thresholds, ...thresholds };
    }

    processAcceleration(z, timestamp) {
        const smoothedZ = z;

        // Almacenar valores para calcular calidad
        if (this.state !== 'IDLE') {
            this.currentRepData.zValues.push(smoothedZ);
            this.currentRepData.maxZ = Math.max(this.currentRepData.maxZ, smoothedZ);
            this.currentRepData.minZ = Math.min(this.currentRepData.minZ, smoothedZ);
        }

        // Máquina de estados
        switch (this.state) {
            case 'IDLE':
                // Detectar inicio de movimiento hacia arriba
                if (smoothedZ > this.thresholds.upwardAcceleration) {
                    this.state = 'PULLING_UP';
                    this.currentRepStartTime = timestamp;
                    this.currentRepData = {
                        maxZ: smoothedZ,
                        minZ: smoothedZ,
                        zValues: [smoothedZ],
                        duration: 0
                    };
                }
                break;

            case 'PULLING_UP':
                // Detectar llegada al punto alto (desaceleración)
                if (smoothedZ < this.thresholds.stableThreshold &&
                    smoothedZ > this.thresholds.downwardAcceleration) {
                    this.state = 'AT_TOP';
                }
                break;

            case 'AT_TOP':
                // Detectar inicio de descenso
                if (smoothedZ < this.thresholds.downwardAcceleration) {
                    this.state = 'LOWERING';
                }
                // Si vuelve a subir, regresar a PULLING_UP
                else if (smoothedZ > this.thresholds.upwardAcceleration) {
                    this.state = 'PULLING_UP';
                }
                break;

            case 'LOWERING':
                // Detectar llegada al punto bajo (vuelta a estable)
                if (smoothedZ > this.thresholds.downwardAcceleration &&
                    smoothedZ < this.thresholds.upwardAcceleration) {
                    // Verificar duración de la rep
                    this.currentRepData.duration = timestamp - this.currentRepStartTime;

                    // Verificar cooldown y validez
                    const timeSinceLastRep = timestamp - this.lastRepTime;
                    const amplitude = this.currentRepData.maxZ - this.currentRepData.minZ;

                    if (this.currentRepData.duration >= this.thresholds.minRepDuration &&
                        this.currentRepData.duration <= this.thresholds.maxRepDuration &&
                        amplitude >= this.thresholds.minAmplitude &&
                        timeSinceLastRep >= this.cooldownPeriod) {
                        // Rep válida completada
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

        // Calcular calidad de la repetición
        this.lastQuality = this.calculateRepQuality();

        // Resetear datos de la rep actual
        this.currentRepData = {
            maxZ: -Infinity,
            minZ: Infinity,
            zValues: [],
            duration: 0
        };
    }

    calculateRepQuality() {
        let quality = 100;

        // Penalizar si la duración es muy corta o muy larga
        const duration = this.currentRepData.duration;
        const idealDuration = 2000; // 2 segundos
        const durationDiff = Math.abs(duration - idealDuration);

        if (durationDiff > 1000) {
            quality -= 15;
        } else if (durationDiff > 500) {
            quality -= 8;
        }

        // Penalizar si el rango de movimiento es pequeño
        const range = this.currentRepData.maxZ - this.currentRepData.minZ;
        if (range < 1.0) {
            quality -= 20;
        } else if (range < 1.5) {
            quality -= 10;
        }

        // Calcular suavidad del movimiento (menor varianza = mejor)
        if (this.currentRepData.zValues.length > 2) {
            const variance = this.calculateVariance(this.currentRepData.zValues);
            if (variance > 1.5) {
                quality -= 15;
            } else if (variance > 0.8) {
                quality -= 8;
            }
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
        this.currentRepData = {
            maxZ: -Infinity,
            minZ: Infinity,
            zValues: [],
            duration: 0
        };
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

// Variables de estado
let isRunning = false;
let isCalibrating = false;
let chart = null;
let intensityGauge = null;
let qualityGauge = null;

// Instancias de detección
let axisFilter = new MovingAverageFilter(5);
let repDetector = new RepDetector();
let autoCalibrator = new AutoCalibrator();
let detectedAxis = 'y'; // Eje vertical detectado: 'x', 'y', o 'z'

// Umbrales calibrados (almacenados)
let calibratedThresholds = null;

// Control de frecuencia de muestreo
let samplingInterval = 33; // ms (30 Hz por defecto)
let lastSampleTime = 0;

// Configuración de datos
const MAX_DATA_POINTS = 100;
const dataPoints = {
    labels: [],
    x: [],
    y: [],
    z: []
};

// ========================================
// INICIALIZACIÓN DE GRÁFICAS
// ========================================

// Inicializar gráfica de Chart.js (línea temporal)
function initChart() {
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
}

// Inicializar gauge de intensidad (ApexCharts)
function initIntensityGauge() {
    const options = {
        series: [0],
        chart: {
            type: 'radialBar',
            height: 220,
            sparkline: {
                enabled: true
            }
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
                    name: {
                        show: false
                    },
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

    intensityGauge = new ApexCharts(document.querySelector('#intensityGauge'), options);
    intensityGauge.render();
}

// Inicializar gauge de calidad (ApexCharts)
function initQualityGauge() {
    const options = {
        series: [0],
        chart: {
            type: 'radialBar',
            height: 220,
            sparkline: {
                enabled: true
            }
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
                    name: {
                        show: false
                    },
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

    qualityGauge = new ApexCharts(document.querySelector('#qualityGauge'), options);
    qualityGauge.render();
}

// Actualizar datos de la gráfica
function updateChart(x, y, z) {
    const timestamp = dataPoints.labels.length;

    dataPoints.labels.push(timestamp);
    dataPoints.x.push(x);
    dataPoints.y.push(y);
    dataPoints.z.push(z);

    // Mantener solo los últimos MAX_DATA_POINTS puntos
    if (dataPoints.labels.length > MAX_DATA_POINTS) {
        dataPoints.labels.shift();
        dataPoints.x.shift();
        dataPoints.y.shift();
        dataPoints.z.shift();
    }

    if (chart) {
        chart.update('none'); // 'none' mode para mejor rendimiento
    }
}

// Controlar visibilidad de ejes en la gráfica
function toggleAxisVisibility(axisIndex, isVisible) {
    if (chart) {
        chart.data.datasets[axisIndex].hidden = !isVisible;
        chart.update();
    }
}

// Actualizar valores en pantalla
function updateValues(x, y, z) {
    xValue.textContent = x.toFixed(2);
    yValue.textContent = y.toFixed(2);
    zValue.textContent = z.toFixed(2);
}

// ========================================
// FUNCIONES DE ACTUALIZACIÓN
// ========================================

// Actualizar contador de repeticiones con animación
function updateRepCounter(count) {
    const prevCount = parseInt(repCountEl.textContent);
    if (count > prevCount) {
        repCountEl.classList.add('pulse');
        setTimeout(() => {
            repCountEl.classList.remove('pulse');
        }, 400);
    }
    repCountEl.textContent = count;
}

// Actualizar fase del ejercicio
function updatePhase(phase) {
    repPhaseEl.textContent = phase;
}

// Actualizar gauge de intensidad
function updateIntensityGauge(axisValue) {
    if (!intensityGauge) return;

    // Mapear valor del eje (-3 a 3) a porcentaje (0-100)
    // Usamos el valor absoluto para mostrar intensidad sin importar dirección
    const absValue = Math.abs(axisValue);
    const percentage = Math.min(100, (absValue / 3) * 100);

    intensityGauge.updateSeries([percentage]);
}

// Actualizar gauge de calidad
function updateQualityGauge(quality) {
    if (!qualityGauge) return;
    qualityGauge.updateSeries([quality]);
}

// Manejar evento de movimiento del dispositivo
function handleMotion(event) {
    if (!isRunning) return;

    // Throttling basado en tiempo
    const now = Date.now();
    if (now - lastSampleTime < samplingInterval) {
        return; // Ignorar este evento
    }
    lastSampleTime = now;

    // Log solo la primera vez para debug
    if (dataPoints.labels.length === 0) {
        console.log('Primer evento devicemotion recibido:', event);
        console.log('Acceleration:', event.acceleration);
        console.log('AccelerationIncludingGravity:', event.accelerationIncludingGravity);
    }

    // Usar acceleration (sin gravedad) en lugar de accelerationIncludingGravity
    const acc = event.acceleration;

    // Si acceleration no está disponible, intentar con accelerationIncludingGravity
    if (!acc || (acc.x === null && acc.y === null && acc.z === null)) {
        const accWithGravity = event.accelerationIncludingGravity;
        if (accWithGravity && (accWithGravity.x !== null || accWithGravity.y !== null || accWithGravity.z !== null)) {
            const x = accWithGravity.x || 0;
            const y = accWithGravity.y || 0;
            const z = accWithGravity.z || 0;

            processAccelerationData(x, y, z);
        } else {
            console.warn('No hay datos de aceleración disponibles');
        }
        return;
    }

    if (acc && acc.x !== null && acc.y !== null && acc.z !== null) {
        const x = acc.x || 0;
        const y = acc.y || 0;
        const z = acc.z || 0;

        processAccelerationData(x, y, z);
    }
}

// Procesar datos de aceleración (nueva función centralizada)
function processAccelerationData(x, y, z) {
    // Actualizar valores en pantalla
    updateValues(x, y, z);

    // Actualizar gráfica temporal
    updateChart(x, y, z);

    // Seleccionar valor del eje detectado como vertical
    let axisValue;
    switch(detectedAxis) {
        case 'x': axisValue = x; break;
        case 'y': axisValue = y; break;
        case 'z': axisValue = z; break;
        default: axisValue = y;
    }

    // Aplicar filtro de suavizado
    const smoothed = axisFilter.addValue(axisValue);

    // Debug: mostrar valores
    if (dataPoints.labels.length % 20 === 0) {
        console.log(`${detectedAxis.toUpperCase()} raw:`, axisValue.toFixed(2), 'smoothed:', smoothed.toFixed(2));
    }

    // Procesar detección de repeticiones
    const timestamp = Date.now();
    const repResult = repDetector.processAcceleration(smoothed, timestamp);

    // Actualizar UI con resultados
    updateRepCounter(repResult.repCount);
    updatePhase(repDetector.getPhaseText());
    updateIntensityGauge(smoothed);

    // Actualizar calidad solo cuando hay una calidad válida
    if (repResult.quality > 0) {
        updateQualityGauge(repResult.quality);
    }
}

// Detectar eje vertical automáticamente usando gravedad
function detectVerticalAxis(statusElement) {
    return new Promise((resolve) => {
        let samplesCollected = 0;
        const samples = { x: [], y: [], z: [] };
        const SAMPLES_NEEDED = 5;

        const handler = (event) => {
            const acc = event.accelerationIncludingGravity;
            if (!acc || acc.x === null || acc.y === null || acc.z === null) {
                return;
            }

            // Recolectar muestras
            samples.x.push(Math.abs(acc.x));
            samples.y.push(Math.abs(acc.y));
            samples.z.push(Math.abs(acc.z));
            samplesCollected++;

            // Mostrar progreso
            statusElement.textContent = 'Detectando... (' + samplesCollected + '/' + SAMPLES_NEEDED + ')';

            if (samplesCollected >= SAMPLES_NEEDED) {
                // Calcular promedios
                const avgX = samples.x.reduce((a, b) => a + b, 0) / SAMPLES_NEEDED;
                const avgY = samples.y.reduce((a, b) => a + b, 0) / SAMPLES_NEEDED;
                const avgZ = samples.z.reduce((a, b) => a + b, 0) / SAMPLES_NEEDED;

                // Mostrar valores detectados
                statusElement.textContent = 'X:' + avgX.toFixed(1) + ' Y:' + avgY.toFixed(1) + ' Z:' + avgZ.toFixed(1);

                // El eje con mayor gravedad es el vertical
                let verticalAxis;
                if (avgX >= avgY && avgX >= avgZ) {
                    verticalAxis = 'x';
                } else if (avgY >= avgX && avgY >= avgZ) {
                    verticalAxis = 'y';
                } else {
                    verticalAxis = 'z';
                }

                console.log('Gravedad detectada - X:', avgX.toFixed(2), 'Y:', avgY.toFixed(2), 'Z:', avgZ.toFixed(2));
                console.log('Eje vertical detectado:', verticalAxis.toUpperCase());

                window.removeEventListener('devicemotion', handler);
                resolve(verticalAxis);
            }
        };

        window.addEventListener('devicemotion', handler);

        // Timeout de seguridad (2 segundos)
        setTimeout(() => {
            window.removeEventListener('devicemotion', handler);
            console.log('Timeout en detección, usando eje Y por defecto');
            statusElement.textContent = 'Timeout - usando Y por defecto';
            resolve('y');
        }, 2000);
    });
}

// Solicitar permisos (necesario para iOS 13+)
async function requestPermission() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
            const permission = await DeviceMotionEvent.requestPermission();
            console.log('Permiso de DeviceMotion:', permission);
            if (permission === 'granted') {
                return true;
            } else {
                status.textContent = 'Permiso denegado. Por favor, permite el acceso al acelerómetro en la configuración de tu navegador.';
                status.className = 'status error';
                return false;
            }
        } catch (error) {
            console.error('Error al solicitar permisos:', error);
            status.textContent = 'Error al solicitar permisos: ' + error.message;
            status.className = 'status error';
            return false;
        }
    }
    return true; // No requiere permisos explícitos
}

// ========================================
// FUNCIONES DE CALIBRACIÓN
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
    progressText.textContent = `Repetición ${repsDetected}/${repsTarget} detectada`;
}

async function startCalibration() {
    // Verificar soporte
    if (!window.DeviceMotionEvent) {
        status.textContent = 'Tu dispositivo no soporta el acelerómetro';
        status.className = 'status error';
        return;
    }

    // Solicitar permisos
    const hasPermission = await requestPermission();
    if (!hasPermission) return;

    // Detectar eje vertical automáticamente
    status.textContent = 'Detectando orientación...';
    status.className = 'status';
    detectedAxis = await detectVerticalAxis(status);

    // Mostrar panel de calibración
    showCalibrationPanel();
    calibrationStatus.textContent = 'Realiza 5 repeticiones completas para calibrar automáticamente. Presiona Iniciar cuando estés listo.';
    progressText.textContent = 'Esperando inicio...';
    calibrationResults.classList.add('hidden');
    applyCalibrateBtn.classList.add('hidden');

    // Inicializar calibrador
    autoCalibrator.startCalibration(5);

    // Resetear datos
    axisFilter.reset();
    dataPoints.labels = [];
    dataPoints.x = [];
    dataPoints.y = [];
    dataPoints.z = [];

    // Empezar a capturar datos
    isCalibrating = true;
    isRunning = true;
    startBtn.textContent = 'Detener';
    startBtn.classList.add('active');

    console.log('Iniciando calibración...');
    window.addEventListener('devicemotion', handleMotionCalibration);

    // Timeout para verificar datos
    setTimeout(() => {
        if (dataPoints.labels.length === 0) {
            calibrationStatus.textContent = 'No se están recibiendo datos del acelerómetro. Verifica los permisos.';
        }
    }, 3000);
}

function handleMotionCalibration(event) {
    if (!isCalibrating) return;

    // Throttling basado en tiempo
    const now = Date.now();
    if (now - lastSampleTime < samplingInterval) {
        return;
    }
    lastSampleTime = now;

    // Obtener datos de aceleración
    const acc = event.acceleration;

    if (!acc || (acc.x === null && acc.y === null && acc.z === null)) {
        const accWithGravity = event.accelerationIncludingGravity;
        if (accWithGravity && (accWithGravity.x !== null || accWithGravity.y !== null || accWithGravity.z !== null)) {
            const x = accWithGravity.x || 0;
            const y = accWithGravity.y || 0;
            const z = accWithGravity.z || 0;

            calibrationProcessData(x, y, z);
        }
        return;
    }

    if (acc && acc.x !== null && acc.y !== null && acc.z !== null) {
        const x = acc.x || 0;
        const y = acc.y || 0;
        const z = acc.z || 0;

        calibrationProcessData(x, y, z);
    }
}

function calibrationProcessData(x, y, z) {
    // Actualizar gráfica
    updateChart(x, y, z);

    // Seleccionar eje
    let axisValue;
    switch(detectedAxis) {
        case 'x': axisValue = x; break;
        case 'y': axisValue = y; break;
        case 'z': axisValue = z; break;
        default: axisValue = y;
    }

    // Aplicar filtro
    const smoothed = axisFilter.addValue(axisValue);

    // Procesar calibración
    const result = autoCalibrator.processValue(smoothed);

    if (result && result.repCount !== undefined) {
        updateCalibrationProgress();

        // Si la calibración está completa
        if (result.thresholds) {
            completeCalibration(result);
        }
    }
}

function completeCalibration(result) {
    isCalibrating = false;
    isRunning = false;
    window.removeEventListener('devicemotion', handleMotionCalibration);

    // Guardar umbrales calibrados
    calibratedThresholds = result.thresholds;
    localStorage.setItem('calibratedThresholds', JSON.stringify(calibratedThresholds));
    localStorage.setItem('calibrationDate', new Date().toISOString());

    // Mostrar resultados
    calibrationStatus.textContent = '✓ ¡Calibración completada!';
    progressBar.style.width = '100%';
    progressText.textContent = 'Umbrales calibrados correctamente';

    // Mostrar valores de umbrales
    thresholdUp.textContent = result.thresholds.upwardAcceleration.toFixed(3);
    thresholdDown.textContent = result.thresholds.downwardAcceleration.toFixed(3);
    thresholdAmplitude.textContent = result.thresholds.minAmplitude.toFixed(3);

    calibrationResults.classList.remove('hidden');
    applyCalibrateBtn.classList.remove('hidden');

    console.log('Calibración completada:', result.thresholds);
}

// ========================================
// FUNCIONES DE UTILIDAD
// ========================================


async function toggleMonitoring() {
    if (!isRunning) {
        // Verificar soporte
        if (!window.DeviceMotionEvent) {
            status.textContent = 'Tu dispositivo no soporta el acelerómetro';
            status.className = 'status error';
            return;
        }

        console.log('Tipo de DeviceMotionEvent:', typeof DeviceMotionEvent);
        console.log('¿Tiene requestPermission?', typeof DeviceMotionEvent.requestPermission);

        // Solicitar permisos
        const hasPermission = await requestPermission();
        if (!hasPermission) return;

        // Detectar eje vertical automáticamente
        status.textContent = 'Detectando orientación...';
        status.className = 'status';
        detectedAxis = await detectVerticalAxis(status);

        // Mostrar resultado de detección
        status.textContent = 'Eje detectado: ' + detectedAxis.toUpperCase() + ' ✓';
        status.className = 'status success';

        // Esperar 2 segundos para que el usuario vea el resultado
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Resetear detectores
        axisFilter.reset();
        repDetector.reset();

        // Aplicar umbrales calibrados si existen
        if (calibratedThresholds) {
            repDetector.setThresholds(calibratedThresholds);
            status.textContent = 'Monitoreando con calibración personalizada (Eje ' + detectedAxis.toUpperCase() + ')';
        } else {
            status.textContent = 'Monitoreando (Eje ' + detectedAxis.toUpperCase() + ')';
        }

        updateRepCounter(0);
        updatePhase('Listo');
        updateQualityGauge(0);

        // Iniciar monitoreo
        isRunning = true;
        startBtn.textContent = 'Detener';
        startBtn.classList.add('active');
        status.textContent = 'Monitoreando (Eje ' + detectedAxis.toUpperCase() + ')';
        status.className = 'status success';

        console.log('Iniciando escucha de eventos devicemotion...');
        window.addEventListener('devicemotion', handleMotion);

        // Timeout para verificar si recibimos datos
        setTimeout(() => {
            if (dataPoints.labels.length === 0) {
                status.textContent = 'No se están recibiendo datos del acelerómetro. Verifica los permisos.';
                status.className = 'status error';
                console.warn('No se han recibido eventos de devicemotion después de 3 segundos');
            }
        }, 3000);
    } else {
        // Detener monitoreo
        isRunning = false;
        startBtn.textContent = 'Iniciar';
        startBtn.classList.remove('active');
        status.textContent = 'Detenido';
        status.className = 'status';

        window.removeEventListener('devicemotion', handleMotion);
    }
}

// ========================================
// INICIALIZACIÓN
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    // Cargar umbrales calibrados desde localStorage si existen
    const savedThresholds = localStorage.getItem('calibratedThresholds');
    if (savedThresholds) {
        try {
            calibratedThresholds = JSON.parse(savedThresholds);
            const calibrationDate = localStorage.getItem('calibrationDate');
            console.log('Umbrales calibrados cargados. Fecha:', calibrationDate);
            status.textContent = '✓ Umbrales calibrados cargados';
            status.className = 'status success';
        } catch (e) {
            console.error('Error al cargar umbrales:', e);
        }
    }

    // Inicializar todas las gráficas
    initChart();
    initIntensityGauge();
    initQualityGauge();

    // Obtener referencias a elementos del control de frecuencia
    const samplingRateSlider = document.getElementById('samplingRate');
    const samplingRateValueEl = document.getElementById('samplingRateValue');

    // Event listener para botón de inicio/detener
    startBtn.addEventListener('click', toggleMonitoring);

    // Event listener para botón de calibración
    calibrateBtn.addEventListener('click', startCalibration);

    // Event listeners para controles del panel de calibración
    closeCalibrateBtn.addEventListener('click', () => {
        isCalibrating = false;
        isRunning = false;
        window.removeEventListener('devicemotion', handleMotionCalibration);
        hideCalibrationPanel();
        startBtn.textContent = 'Iniciar';
        startBtn.classList.remove('active');
        status.textContent = 'Calibración cancelada';
        status.className = 'status';
    });

    applyCalibrateBtn.addEventListener('click', () => {
        hideCalibrationPanel();
        status.textContent = 'Umbrales aplicados. Presiona Iniciar para empezar.';
        status.className = 'status success';
    });


    // Event listeners para los toggles de ejes
    toggleX.addEventListener('change', (e) => {
        toggleAxisVisibility(0, e.target.checked);
    });

    toggleY.addEventListener('change', (e) => {
        toggleAxisVisibility(1, e.target.checked);
    });

    toggleZ.addEventListener('change', (e) => {
        toggleAxisVisibility(2, e.target.checked);
    });

    // Event listener para control de frecuencia de muestreo
    samplingRateSlider.addEventListener('input', (e) => {
        const hz = parseInt(e.target.value);
        samplingInterval = 1000 / hz; // Convertir Hz a ms
        samplingRateValueEl.textContent = hz + ' Hz';
        console.log('Frecuencia de muestreo ajustada a', hz, 'Hz (', samplingInterval.toFixed(1), 'ms )');
    });

    // Registrar Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .then(() => console.log('Service Worker registrado'))
            .catch(err => console.log('Error al registrar Service Worker:', err));
    }

    console.log('Training Tracker inicializado correctamente');
});
