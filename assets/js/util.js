/**
 *  run utility algorithms and methods that require other modules
 * */
class algorithms {
    get [Symbol.toStringTag]() {
        return 'Algorithms';
    }

    /**
     * 
     * @param {graph} modules.model
     * @param {logger} modules.logger
     * @param {panoramaViewer} modules.panorama
     * @param {filesystem} modules.filesys
     */
    constructor(modules) {
        this.modules = modules;
        this.filenamePattern = /([+-]?\d+(?:\.\d+)?),\s+([+-]?\d+(?:\.\d+)?)\.jpg/;
    }

    /**
 * 
 * Resolves references to other tour files
 * Calls loadGraph(...) to create all the model elements
 * View related settings will not be read
 * 
 * Required modules: model, filesystem
 * 
 * @param {JSON} tour - Plain javascript object
* @param {directory} rootFolder - Folder containing the file which content was passed as the first argument
 * @returns {Rx.Observable<boolean>} - Tour model was created without errors
 */
    readTour(tour, rootFolder) {
        var successful = true;

        //process temporal groups before others so that parent tour files can modify their hierarchy
        for (let jsonTemporalGroup of (tour.temporalGroups || [])) {
            try {
                var tg = this.modules.model.createTemporalGroup(Object.assign({}, jsonTemporalGroup, {
                    directory: rootFolder,
                    subGroups: []
                }));
            } catch (err) {
                this.modules.logger.log(err);
                successful = false;
            }
        }

        var other = Rx.Observable.of(successful);
        if (tour.tours != null) {
            other = Rx.Observable.from(tour.tours)
                .mergeMap(path => rootFolder.searchFile(path))
                .mergeMap(f =>
                    f.readAsJSON()
                        .mergeMap(t => this.readTour(t, f.parent))
                );
        }

        return other.map(successful => successful && this.loadGraph(tour, rootFolder));
    }

    /**
     * 
     * Creates the groups and graph
     * Called by readTour(...)
     * 
     * Required modules: model
     * 
     * @param {JSON} tour - Plain javascript object
     * @param {directory} dir - Folder containing the file which content was passed as the first argument
     * @returns {boolean} - Tour model was created without errors
     */
    loadGraph(tour, rootDirectory) {
        var successful = true;
        rootDirectory = rootDirectory || this.filesys;

        var edges = [];
        var vertices = tour.vertices || [];
        var spatialGroups = tour.spatialGroups || [];
        var temporalGroups = tour.temporalGroups || [];

        for (let jsonTemporalGroup of temporalGroups) {
            try {
                var tg = this.modules.model.createTemporalGroup(Object.assign({}, jsonTemporalGroup, {
                    subGroups: []
                })); //copy vertex properties ignoring vertices, parsing date and storing directory

                var gr = jsonTemporalGroup.subGroups || [];
                gr.forEach(g => g.superGroup = tg);
                spatialGroups = spatialGroups.concat(gr);
            } catch (err) {
                this.modules.logger.log(err);
                successful = false;
            }
        }

        for (let jsonSpatialGroup of spatialGroups) {
            try {
                var sg = this.modules.model.createSpatialGroup(Object.assign({}, jsonSpatialGroup, {
                    vertices: []
                })); //copy vertex properties ignoring vertices, parsing date and storing directory

                sg.directory = rootDirectory;
                var ver = jsonSpatialGroup.vertices || [];
                ver.forEach(v => v.spatialGroup = sg);
                vertices = vertices.concat(ver);
            } catch (err) {
                this.modules.logger.log(err);
                successful = false;
            }
        }

        for (var jsonVertex of vertices) {
            try {
                var v = this.modules.model.createVertex(Object.assign({}, jsonVertex, {
                    outgoingEdges: [],
                })); //copy vertex properties ignoring outgoingEdges

                var ed = jsonVertex.outgoingEdges || [];
                ed.forEach(e => e.from = v);
                edges = edges.concat(ed);
            } catch (err) {
                this.modules.logger.log(err);
                successful = false;
            }
        }

        for (let e of edges) {
            try {
                this.modules.model.createEdge(e);
            } catch (err) {
                this.modules.logger.log(err);
                successful = false;
            }
        }
        return successful;
    }

    /**
     * Create a file and offer it for download
     * 
     * @param {any} content
     */
    saveJSON(content) {
        var saveData = (function () {
            var a = document.createElement("a");
            document.body.appendChild(a);
            a.style = "display: none";
            return function (data, fileName) {
                var blob = new Blob([JSON.stringify(data, null, 4)], { type: "text/json" }),
                    url = window.URL.createObjectURL(blob);
                a.href = url;
                a.download = fileName;
                a.click();
                window.URL.revokeObjectURL(url);
            };
        }());

        saveData(content, "tour.json");
    }

    /**
     * Given: yaw from manually set landmark hotspots
     * Search space: Coordinates and northOffset of scene
     * Uses northOffset and coordinates to compute azimuth for each landmark hotspot
     * Objective function: Minimize difference between yaw and azimuth.
     * Performs gradient decent (with estimated gradients) to find the optimal solution
     * 
     * Required modules: panorama
     * 
      * @param {scene} scene
      * @param {[hotspot]} hotspots
      * @returns {Rx.Observable<JSON>} - {solution: {northOffset, coordinates}, f} where f is the standard deviation taken over all hotspots
      */
    optimize(scene, hotspots) {
        return Rx.Observable.create(observer => {

            let sqr = function (x) { return x * x; };
            let mean = function (angles) {
                var sin = 0, cos = 0;
                for (let a of angles) {
                    sin += Math.sin(a / 180 * Math.PI);
                    cos += Math.cos(a / 180 * Math.PI);
                }

                return Math.atan2(sin, cos) / Math.PI * 180;
            };
            let normalize = function (angle) {
                return angle > 180 ? angle - 360 : (angle < -180 ? angle + 360 : angle);
            };

            let objective = function (coordinates) {
                var [lat, lon] = coordinates;
                if (lat > 90.0 || lat < -90.0 || lon > 180.0 || lon < -180.0) {
                    //                       console.log([lat, lon]);
                    return Number.POSITIVE_INFINITY;

                }

                let angles = hotspots.map(hs => normalize(hs.yaw - panoramaViewer.getAzimuth(coordinates, hs.edge.to)));
                var northOffset = mean(angles);
                var sum = angles.map(a => sqr(normalize(a - northOffset))).reduce((a, b) => a + b);
                //           console.log([coordinates, angles, sum]);
                if (!Number.isFinite(sum)) {
                    return Number.POSITIVE_INFINITY;
                }
                return Math.sqrt(sum / angles.length);
            };

            let start = scene.vertex.coordinates || config.coordinates;
            let result = numeric.uncmin(objective, start, 1e-7);
            // console.log(result);
            if (!result.solution)
                observer.error(result.message);
            else {
                result.solution = {
                    northOffset: mean(hotspots.map(hs => hs.yaw - panoramaViewer.getAzimuth(result.solution, hs.edge.to))),
                    coordinates: result.solution
                };
            }


            observer.next(result);
            observer.complete();

        });
    }

    /**
     * Required modules: model
     * 
     * @param {spatialGroup} sg
     * @param {[number]} coordinates
     * @param {number} [distanceThreshold]
     * @returns {vertex | null} - vertex from sg closest to coordinates and within distanceThreshold
     */
    getColocated(sg, coordinates, distanceThreshold) {
        var vMin = null;
        var minDist = distanceThreshold;
        if (distanceThreshold == null)
            minDist = sg.superGroup.getColocatedRadius() || 0;

        sg.forEach(other => {
            let distance = panoramaViewer.getDistance(coordinates, other);
            if (distance <= minDist) { //for minDist == 0
                minDist = distance;
                vMin = other;
            }
        });

        return vMin;
    }

    /**
     * Required modules: model
     * 
     * @param {vertex} v
     * @returns {[edge]} - destination vertex computed by getColocated(...)
     */
    connectColocated(v) {
        var established = new Map();
        var edges = [];
        established.set(v.spatialGroup.id, v.spatialGroup);
        v.forEach(e => {
            if (e.type === edge.prototype.TEMPORAL) {
                let g = e.to.spatialGroup.superGroup;
                established.set(g.id, g);
                edges.push(e);
            }
        });

        v.spatialGroup.superGroup.forEach(g => {
            if (established.get(g.id) == null && g instanceof spatialGroup && g.type !== spatialGroup.prototype.LANDMARK) {
                var vMin = this.getColocated(g, v.coordinates);
                if (vMin) {
                    edges.push(this.modules.model.createEdge({ from: v, to: vMin, type: edge.prototype.TEMPORAL, bidirectional: true }));
                }
            }
        });

        return edges;
    }

    /**
     * Tries to parse coordinates from filename
     * 
     * @param {string} filename
     * @returns {[number] | null}
     */
    extractCoordinates(filename) {
        if (filename == null)
            return null;

        let match = this.filenamePattern.exec(filename);
        if (match) {
            return [Number.parseFloat(match[1]), Number.parseFloat(match[2])];
        } else {
            return null;
        }

    }

    /**
     * 
     * @param {any} obj
     * @returns {any} - all numbers, booleans, and non-empty strings in obj
     *  - undefined if the return value would otherwise be empty
     */
    static extractAtomicProperties(obj) {
        var res = {};
        var count = 0;
        for (let attr in obj) {
            let type = typeof obj[attr];
            if (type === 'number' || type === 'boolean' || type === 'symbol') {
                res[attr] = obj[attr];
                count++;
            }
            if (type === 'string' && obj[attr].length > 0) {
                res[attr] = obj[attr];
                count++;
            }
        }

        return count > 0 ? res : undefined;
    }

    /**
     * 
     * @param {function} fn
     * @returns {Worker} - runs fn
     */
    static createInlineWorker(fn) {
        let blob = new Blob(
            [
                'self.cb = ', fn.toString(), ';',
                'self.onmessage = function (e) { self.cb(e.data) }'
            ], {
                type: 'text/javascript'
            }
        )

        let url = URL.createObjectURL(blob)

        return new Worker(url)
    }

    /**
     * adopted from pannellum.js 
    * Parses Google Photo Sphere XMP Metadata.
    * https://developers.google.com/photo-sphere/metadata/
    * 
    * Required modules: filesystem
    * 
    * @private
    * @param { file } file - Image to read XMP metadata from.
    * @returns {Rx.Observable<JSON>} - xmp data
    */
    static parseGPanoXMP(file) {
        return file.readAsBinaryString().mergeMap(img =>
            Rx.Observable.create(observer => {

                // This awful browser specific test exists because iOS 8 does not work
                // with non-progressive encoded JPEGs.
                if (navigator.userAgent.toLowerCase().match(/(iphone|ipod|ipad).* os 8_/)) {
                    var flagIndex = img.indexOf('\xff\xc2');
                    if (flagIndex < 0 || flagIndex > 65536)
                        anError(config.strings.iOS8WebGLError);
                }

                var start = img.indexOf('<x:xmpmeta');
                if (start > -1 && config.ignoreGPanoXMP !== true) {
                    var xmpData = img.substring(start, img.indexOf('</x:xmpmeta>') + 12);

                    // Extract the requested tag from the XMP data
                    var getTag = function (tag) {
                        var result;
                        if (xmpData.indexOf(tag + '="') >= 0) {
                            result = xmpData.substring(xmpData.indexOf(tag + '="') + tag.length + 2);
                            result = result.substring(0, result.indexOf('"'));
                        } else if (xmpData.indexOf(tag + '>') >= 0) {
                            result = xmpData.substring(xmpData.indexOf(tag + '>') + tag.length + 1);
                            result = result.substring(0, result.indexOf('<'));
                        }
                        if (result !== undefined) {
                            return Number(result);
                        }
                        return null;
                    };

                    // Relevant XMP data
                    var xmp = {
                        fullWidth: getTag('GPano:FullPanoWidthPixels'),
                        croppedWidth: getTag('GPano:CroppedAreaImageWidthPixels'),
                        fullHeight: getTag('GPano:FullPanoHeightPixels'),
                        croppedHeight: getTag('GPano:CroppedAreaImageHeightPixels'),
                        topPixels: getTag('GPano:CroppedAreaTopPixels'),
                        heading: getTag('GPano:PoseHeadingDegrees'),
                        horizonPitch: getTag('GPano:PosePitchDegrees'),
                        horizonRoll: getTag('GPano:PoseRollDegrees'),
                        type: getTag('GPano: ProjectionType')
                    };

                    observer.next(xmp);
                    observer.complete();
                } else {
                    observer.error();
                }
            })
        );
    }

    /**
     * 
     * @param {[[Number]]} sourceCorners - 4 2-D points
     * @param {[[Number]]} destinationCorners - 4 2-D points
     * 
     * @returns {[Number]} - 3x3 homogen transformation matrix
     */
    static getTransformationMatrix(sourceCorners, destinationCorners) {
        function adj(m) { // Compute the adjugate of m
            return [
                m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
                m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
                m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]
            ];
        }
        function multmm(a, b) { // multiply two matrices
            var c = Array(9);
            for (var i = 0; i != 3; ++i) {
                for (var j = 0; j != 3; ++j) {
                    var cij = 0;
                    for (var k = 0; k != 3; ++k) {
                        cij += a[3 * i + k] * b[3 * k + j];
                    }
                    c[3 * i + j] = cij;
                }
            }
            return c;
        }
        function multmv(m, v) { // multiply matrix and vector
            return [
                m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
                m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
                m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
            ];
        }
        function pdbg(m, v) {
            var r = multmv(m, v);
            return r + " (" + r[0] / r[2] + ", " + r[1] / r[2] + ")";
        }
        function basisToPoints(x1, y1, x2, y2, x3, y3, x4, y4) {
            var m = [
                x1, x2, x3,
                y1, y2, y3,
                1, 1, 1
            ];
            var v = multmv(adj(m), [x4, y4, 1]);
            return multmm(m, [
                v[0], 0, 0,
                0, v[1], 0,
                0, 0, v[2]
            ]);
        }
        function general2DProjection(
            x1s, y1s, x1d, y1d,
            x2s, y2s, x2d, y2d,
            x3s, y3s, x3d, y3d,
            x4s, y4s, x4d, y4d
        ) {
            var s = basisToPoints(x1s, y1s, x2s, y2s, x3s, y3s, x4s, y4s);
            var d = basisToPoints(x1d, y1d, x2d, y2d, x3d, y3d, x4d, y4d);
            return multmm(d, adj(s));
        }
        function project(m, x, y) {
            var v = multmv(m, [x, y, 1]);
            return [v[0] / v[2], v[1] / v[2]];
        }

        var sm = basisToPoints(sourceCorners.flat());
        var dm = basisToPoints(destinationCorners.flat());

        var t = multmm(dm, adj(sm));
        for (var i = 0; i != 9; ++i) t[i] = t[i] / t[8];
        return t;


    }

    /**
     * 
     * @param {[[Number]]} points
     * @returns {[[Number]]}
     */
    static getAxisAlignedBoundingBox(points) {
        var min = (a, b) => Math.min(a, b);
        var max = (a, b) => Math.max(a, b);
        return [
            [
                points.map(x => x[0]).reduce(min), // min x
                points.map(x => x[1]).reduce(min) // min y
            ], [
                points.map(x => x[0]).reduce(max), // max x
                points.map(x => x[1]).reduce(max) // max y
            ]
        ];
    }

    /**
     * 
     * @param {HTMLImageElement} img
     * @param {[[Number]]} destinationCorners - several 2-D points, 
     *  - the lower left corner of the image is projected to the first point
     *  - 2 points: completed to an axis aligned rectangle
     *  - 3 points: completed to a parallelogram
     * @returns {[[Number]]} - 4x4 homogen transformation matrix
     */
    static getCSSTransformationMatrix(img, destinationCorners) {
        var w = img.width;
        var h = img.height;
        var d = destinationCorners;

        var aabb = this.getAxisAlignedBoundingBox(destinationCorners);
        var dist = (x, y) => Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2));
       // aabb[1][0] - aabb[0][1]
       // (d[1][0] - d[0][1]) *
       // var w = Math.max()



    var w = elt.offsetWidth, h = elt.offsetHeight;
    var t = general2DProjection
            (0, 0, x1, y1, w, 0, x2, y2, 0, h, x3, y3, w, h, x4, y4);

        return {
            image: transformedImage,
            bounds: aabb
        }

}
}
