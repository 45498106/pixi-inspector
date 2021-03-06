import {AttributeParser} from "./attributes/AttributeParser";
import {domAttr} from "./decorators/domAttr";
import {domLeaf} from "./decorators/domLeaf";
import {domHidden} from "./decorators/domHidden";

export class PixiInspector {

    private _rootElement: HTMLPixiElement;
    private readonly _elementPool = new ElementPool();
    private readonly _tempRect = new PIXI.Rectangle();
    private readonly _mutationObserver = new MutationObserver(mutations => this.onDomChange(mutations));

    private _updateInterval = 0.2;
    private _updateIntervalId: number;
    private _pointerEvents: boolean;

    private static styleSheet: CSSStyleSheet;

    constructor(private _rootNode: PIXI.Container,
                private _canvas: HTMLCanvasElement) {
        this.createStyleSheet();
        this.update();
        _canvas.parentNode.insertBefore(this._rootElement, _canvas.nextSibling);
        this.addDocumentListeners();
        this.startUpdateInterval();
    }

    domAttr<T extends PIXI.DisplayObject, P>(nodeType: { new(...args: any[]): T },
                                             propertyName: keyof T,
                                             parser?: AttributeParser<P> | { new(): AttributeParser<P> }): this {
        domAttr(parser)(nodeType.prototype, propertyName as string);
        return this;
    }

    domLeaf<T extends PIXI.DisplayObject>(nodeType: { new(...args: any[]): T }) {
        domLeaf()(nodeType);
        return this;
    }

    domHidden<T extends PIXI.DisplayObject>(nodeType: { new(...args: any[]): T }) {
        domHidden()(nodeType);
        return this;
    }

    get updateInterval(): number {
        return this._updateInterval;
    }

    set updateInterval(value: number) {
        if (this._updateInterval != value) {
            this._updateInterval = value;
            this.startUpdateInterval();
        }
    }

    private startUpdateInterval() {
        clearInterval(this._updateIntervalId);
        this._updateIntervalId = setInterval(() => this.update(), this._updateInterval * 1000);
    }

    update() {
        PixiInspector.styleSheet.disabled = true;
        this._mutationObserver.disconnect();
        this._rootElement = this.buildElement(this._rootNode, this._rootElement);
        this._mutationObserver.observe(this._rootElement, {subtree: true, attributes: true});
        PixiInspector.styleSheet.disabled = false;
    }

    private buildElement(node: PIXI.DisplayObject, element?: HTMLPixiElement): HTMLPixiElement {
        element = element || this._elementPool.get(node);
        element.pixiTarget = node;
        this.setElementStyle(node, element);
        this.setElementAttributes(node, element);
        if (node instanceof PIXI.Container && !(<any>node)['__pixi_inspector_is_leaf__']) {
            let i = 0;
            let n = Math.min(node.children.length, element.childNodes.length);
            for (; i < n; i++) {
                let childElement = element.childNodes[i] as HTMLPixiElement;
                let childNode = node.children[i];
                if (childElement.pixiTarget == childNode) {
                    this.buildElement(childNode, childElement);
                } else {
                    element.replaceChild(this.buildElement(childNode), childElement);
                    this.releaseElement(childElement);
                }
            }
            while (element.childNodes.length > n) {
                this.releaseElement(element.lastChild as HTMLPixiElement);
                element.lastChild.remove();
            }
            n = node.children.length;
            for (; i < n; i++) {
                element.appendChild(this.buildElement(node.children[i]));
            }
        }
        return element;
    }

    private releaseElement(element: HTMLPixiElement) {
        element.pixiTarget = null;
        while (element.attributes.length > 1) {
            element.removeAttributeNode(element.attributes[1]);
        }
        while (element.childNodes.length > 0) {
            this.releaseElement(element.lastChild as HTMLPixiElement);
            element.lastChild.remove();
        }
        this._elementPool.release(element);
    }

    private setElementStyle(node: PIXI.DisplayObject, element: HTMLPixiElement) {
        let bounds = node.getBounds(false, this._tempRect);
        if (!element.pixiStyle) {
            let index = PixiInspector.styleSheet.cssRules.length;
            PixiInspector.styleSheet.insertRule(`#px${index} {position:fixed;top:0;left:0;width:0;height:0}`, index);
            element.pixiStyle = (PixiInspector.styleSheet.cssRules[index] as CSSStyleRule).style;
            element.id = `px${index}`;
        }
        let style = element.pixiStyle;
        if ((<any>node)['__pixi_inspector_is_hidden__']) {
            style.display = 'none';
        }
        style.top = `${(bounds.top + this._canvas.offsetTop).toFixed(2)}px`;
        style.left = `${(bounds.left + this._canvas.offsetLeft).toFixed(2)}px`;
        style.width = `${(bounds.width).toFixed(2)}px`;
        style.height = `${(bounds.height).toFixed(2)}px`;
    }

    private setElementAttributes(node: PIXI.DisplayObject, element: HTMLPixiElement) {
        let attributes = (<any>node)['__pixi_inspector_attributes__'] as DomAttribute[];
        if (attributes) {
            for (let attribute of attributes) {
                let value;
                try {
                    value = (<any>node)[attribute.name];
                } catch (e) {
                    continue;
                }
                if (attribute.parser.visible(value)) {
                    element.setAttribute(attribute.name, attribute.parser.stringify(value));
                }
            }
        }
    }

    private onDomChange(mutations: MutationRecord[]) {
        for (let mutation of mutations) {
            if (mutation.type == 'attributes') {
                let element = mutation.target as HTMLPixiElement;
                let node = element.pixiTarget;
                if (node) {
                    let value = element.getAttribute(mutation.attributeName);
                    let name = mutation.attributeName.toLowerCase();
                    let attributes = (<any>node)['__pixi_inspector_attributes__'] as DomAttribute[];
                    if (attributes) {
                        for (let attribute of attributes) {
                            if (attribute.name.toLowerCase() == name) {
                                (<any>node)[attribute.name] = attribute.parser.parse(value, (<any>node)[attribute.name]);
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    private createStyleSheet() {
        if (!PixiInspector.styleSheet) {
            let style = document.createElement('style');
            style.appendChild(document.createTextNode('' +
                '[id^="px"] {pointer-events:none;}' +
                '[id^="px"]:empty {pointer-events:none;}' +
                '[id^="px"]:empty:hover {background:rgba(255,255,255,0.2);border:solid 1px #fff}'));
            document.head.appendChild(style);
            PixiInspector.styleSheet = style.sheet as CSSStyleSheet;
        }
    }

    private addDocumentListeners() {
        let ctrl = 17;
        let style = (PixiInspector.styleSheet.cssRules[1] as CSSStyleRule).style;
        document.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.which == ctrl && !this._pointerEvents) {
                this._pointerEvents = true;
                style.pointerEvents = 'auto';
            }
        });
        document.addEventListener('keyup', (event: KeyboardEvent) => {
            if (event.which == ctrl && this._pointerEvents) {
                this._pointerEvents = false;
                style.pointerEvents = 'none';
            }
        });
        document.addEventListener('click', (event: Event) => {
            let target = (<any>event.target).pixiTarget;
            if (target) {
                (<any>window).$pixi = target;
            }
        });
        document.addEventListener('contextmenu', (event: Event) => {
            let target = (<any>event.target).pixiTarget;
            if (target) {
                (<any>window).$pixi = target;
            }
        });
    }
}

interface DomAttribute {
    name: string,
    parser: AttributeParser<any>;
}

interface HTMLPixiElement extends HTMLDivElement {
    pixiTarget: PIXI.DisplayObject;
    pixiStyle: CSSStyleDeclaration;
}

class ElementPool {

    private static readonly defaultConstructors: [Function, string][] = [
        [PIXI.mesh.NineSlicePlane, 'NineSlicePlane'],
        [PIXI.mesh.Plane, 'Plane'],
        [PIXI.mesh.Rope, 'Rope'],
        [PIXI.Text, 'Text'],
        [PIXI.extras.BitmapText, 'BitmapText'],
        [PIXI.extras.AnimatedSprite, 'AnimatedSprite'],
        [PIXI.extras.TilingSprite, 'TilingSprite'],
        [PIXI.Sprite, 'Sprite'],
        [PIXI.Graphics, 'Graphics'],
        [PIXI.Container, 'Container'],
    ];

    private readonly pools: { [tagName: string]: HTMLPixiElement[] } = {};

    get(obj: PIXI.DisplayObject): HTMLPixiElement {
        let tagName = 'px-' + this.getTagName(obj).toLowerCase();
        if (!Array.isArray(this.pools[tagName])) {
            this.pools[tagName] = [];
            if (!customElements.get(tagName)) {
                customElements.define(tagName, function () {
                }, {extends: 'div'});
            }
        }
        return this.pools[tagName].pop() || document.createElement(tagName) as HTMLPixiElement;
    }

    release(element: HTMLPixiElement) {
        if (this.pools[element.localName].indexOf(element) < 0) {
            this.pools[element.localName].push(element);
        }
    }

    private getTagName(obj: PIXI.DisplayObject): string {
        let className: string = null;
        if (obj.constructor) {
            let exec = /function\s+(\w{2,})\(/.exec(obj.constructor.toString());
            className = exec ? exec[1] : null;
        }
        if (className) {
            return className;
        }
        for (let defaultConstructor of ElementPool.defaultConstructors) {
            if (obj instanceof defaultConstructor[0]) {
                return defaultConstructor[1];
            }
        }
        return 'DisplayObject';
    }
}