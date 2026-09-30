import { PineMatrixObject } from '../PineMatrixObject';
import { Context } from '../../../Context.class';
import { Series } from '../../../Series';
import { PineArrayObject } from '../../array/PineArrayObject';

export function add_row(context: Context) {
    return (id: PineMatrixObject, row_index?: number, values?: any) => {
        // Named arguments (`m.add_row(array_id=a)`, `m.add_row(row=0, array_id=a)`) arrive as one plain
        // object in the last position; unpack it (otherwise the row was added EMPTY).
        const named = [values, row_index].find((x: any) => x && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype);
        if (named) {
            if (named === row_index) row_index = undefined;
            row_index = row_index ?? (named as any).row;
            values = (named as any).array_id;
        }
        const rows = id.matrix.length;

        let rowValues: any[] = [];
        if (values) {
            if (values instanceof PineArrayObject) {
                rowValues = values.array;
            } else if (Array.isArray(values)) {
                rowValues = values;
            } else {
                if (values instanceof Series) {
                    // If it's a Series, it might be wrapping the array
                    // e.g. $.param([1,2,3]) -> Series([1,2,3])
                    const val = values.get(0);
                    if (Array.isArray(val)) {
                        rowValues = val;
                    } else {
                        rowValues = [val];
                    }
                } else {
                    rowValues = [values];
                }
            }
        }

        const cols = rows > 0 ? id.matrix[0].length : rowValues.length;
        const index = row_index !== undefined ? row_index : rows;

        const newRow = [];
        for (let i = 0; i < cols; i++) {
            if (i < rowValues.length) {
                let val = rowValues[i];
                if (val instanceof Series) {
                    val = val.get(0);
                }
                newRow.push(val);
            } else {
                newRow.push(NaN);
            }
        }

        id.matrix.splice(index, 0, newRow);
    };
}
