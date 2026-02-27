import { JSDOM } from 'jsdom';
import { registerFont, createCanvas } from 'canvas';

export async function sebDOM(width, height) {
    const { window } = new JSDOM('<!DOCTYPE html><html><body></body></html>');

    const canvas = createCanvas(width, height, "svg");
    const ctx = canvas.getContext('2d');
    registerFont('../fonts/Open_Sans/static/OpenSans-Regular.ttf', { family: 'Open Sans' });
    ctx.font = '12px "Open Sans"';

    window.extend(SVG.Text, {
        getBBox: function () {
            const {
                font,
                text,
                leading
            } = this.attr();
            const fontSize = font.size || 12;
            ctx.font = `${fontSize}px "${font.family || 'Open Sans'}"`;
            const metrics = ctx.measureText(text);
            return {
                x: this.x(),
                y: this.y(),
                width: metrics.width,
                height: fontSize * leading || fontSize,
            };
        }
    });

    
    const { document } = window;
    // Minimal globals expected by libraries
    global.window = window;
    global.document = document;

    return { window, document };
}