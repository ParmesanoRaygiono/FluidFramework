import * as pragueMap from "@prague/map";
import { FrameLoader, IFrameLoaderCallbacks } from "./frameLoader";
import { getCollabDoc } from "./pragueUtil";

function setSpanText(spanName, message) {
    (document.getElementById(spanName) as HTMLSpanElement).innerHTML = message;
}

function setStatusMessage(msg) {
    setSpanText("status", msg);
}

function setLatency(dataMapView, startLoadTime) {
    const endTime = dataMapView.get("END_DATE");
    setSpanText("attachtime", Math.round(dataMapView.get("TIME_ATTACH")) + " ms");
    setSpanText("bgwkrlatency", Math.round(endTime - dataMapView.get("FG_END_DATE")) + " ms");
    setSpanText("latency", Math.round(startLoadTime.valueOf() - endTime) + " ms (Live only)");
}
const scale = document.getElementById("scale") as HTMLInputElement;

const scrollPosField = document.getElementById("SCROLLPOS") as HTMLSpanElement;
let scaleListener;
class FrameLoaderCallbacks implements IFrameLoaderCallbacks {
    private startTime: number;
    private startLoadTime: Date;
    private dataMapView: pragueMap.IMapView;
    public onDOMDataNotFound() {
        setStatusMessage("DOM not found");
        setSpanText("URL", "Empty");
    }
    public onDOMDataFound(startLoadTime: Date, dataMapView: pragueMap.IMapView) {
        this.startLoadTime = startLoadTime;
        this.dataMapView = dataMapView;
        setStatusMessage("Creating DOM");
        setSpanText("config",
            (dataMapView.get("CONFIG_BATCHOP") ? "Batched " : "") +
            (dataMapView.get("CONFIG_BACKGROUND") ? "Background " : ""));
        setSpanText("inittime", Math.round(dataMapView.get("TIME_INIT")) + " ms");
        setSpanText("signaltime", Math.round(dataMapView.get("TIME_STARTSIGNAL")) + " ms (Nav Only)");
        setSpanText("savetime", Math.round(dataMapView.get("TIME_STARTSAVE")) + " ms");
        setSpanText("docloadtime", Math.round(dataMapView.get("TIME_DOCLOAD")) + " ms");
        setSpanText("gentime", Math.round(dataMapView.get("TIME_GEN")) + " ms");

        setSpanText("URL", dataMapView.get("URL"));
        if (scaleListener) {
            scale.removeEventListener("change", scaleListener);
        }
        scaleListener = () => {
            FrameLoader.setDimension(iframe, dataMapView, this);
        };
        scale.addEventListener("change", scaleListener);

        this.startTime = performance.now();
    }

    public onTreeGenerated() {
        setSpanText("domgentime", Math.round(performance.now() - this.startTime) + "ms");
        setStatusMessage("DOM generated");

        if (this.dataMapView.has("END_DATE")) {
            setLatency(this.dataMapView, this.startLoadTime);
        } else {
            setSpanText("attachtime", "");
            setSpanText("bgwkrlatency", "");
            setSpanText("latency", "");
        }
    }

    public onValueChanged(key) {
        switch (key) {
            case "DATE":
                setSpanText("latency", Math.round(this.startLoadTime.valueOf() - this.dataMapView.get("DATE"))
                    + " ms (Live only)");
                return true;
            case "END_DATE":
                setLatency(this.dataMapView, this.startLoadTime);
                return true;
            case "TIME_ATTACH":
            case "FG_END_DATE":
                return true;
        }
    }

    public getScrollPosField() {
        return scrollPosField;
    }

    public getViewScale() {
        return parseInt(scale.value, 10);
    }

    public onDimensionUpdated(dimension: any, scaleStr: string, boundingRect: any, viewScaleValue: number) {
        const dimensionField = document.getElementById("DIMENSION") as HTMLSpanElement;
        dimensionField.innerHTML = dimension.width + " x " + dimension.height + " " + scaleStr;
        setSpanText("scaleValue",
            viewScaleValue + "% (" + boundingRect.width.toFixed(0) + ", " + boundingRect.height.toFixed(0) + ")");
    }
}

async function initFromPrague(documentId: string) {
    setStatusMessage("Loading document " + documentId);

    const collabDoc = await getCollabDoc(documentId);
    const rootView = await collabDoc.getRoot().getView();

    FrameLoader.syncRoot(iframe, rootView, new FrameLoaderCallbacks());
}

const query = window.location.search.substring(1);
const search = new URLSearchParams(query);
const fullView = search.has("full") && search.get("full") === "true";
const debugView = search.has("debug") && search.get("debug") === "true";
const iframe = document.getElementById("view") as HTMLIFrameElement;

if (!fullView) {
    document.getElementById("top").className = "";
    iframe.className = "";
    if (debugView) {
        document.getElementById("side").className = "";
    }
}

if (search.has("docId")) {
    const docId = search.get("docId");
    document.title += " - " + docId;
    initFromPrague(docId).catch((error) => { console.error(error); });
}
