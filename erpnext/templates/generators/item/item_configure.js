class ItemConfigure {
    constructor(itemCode, itemName) {
        this.itemCode = itemCode;
        this.itemName = itemName;

        this.initialize();
    }

    async initialize() {
        try {
            this.attributeData = await this.getAttributesAndValues();
            const attributeName = this.attributeData[0].attribute;
            const attributeValues = this.attributeData[0].values.map(value => ({ [attributeName]: value }));

            const finalValues = await Promise.all(attributeValues.map(element => this.getNextAttributeAndValues(element)));

            this.data = this.processFinalValues(finalValues);

            this.showConfigureDialog();
        } catch (error) {
            console.error(error);
        }
    }

    processFinalValues(finalValues) {
        const processedValues = [];

        finalValues.forEach(value => {
            const options = value.valid_options_for_attributes;
            const exactMatch = value.exact_match[0];

            if (options && exactMatch && value.product_info.price && value.product_info.price.price_list_rate && value.available_qty > 0) {
                const attributeName = Object.keys(options)[0];
                const attributeValues = options[attributeName];

                attributeValues.forEach(attributeValue => {
                    const itemData = {
                        [attributeName]: attributeValue,
                        stock_qty: value.available_qty,
                        item_code: exactMatch,
                        unit_price: value.product_info.price.formatted_price,
                        box_price: value.product_info.price.formatted_price_sales_uom,
                        available_qty: value.available_qty,
                        qty: "",
                        allow_items_not_in_stock: value.product_info.allow_items_not_in_stock
                    };

                    processedValues.push(itemData);
                });
            }
        });

        return processedValues;
    }


    showConfigureDialog() {
        const attributeName = this.attributeData[0].attribute;
        const attributeValues = this.attributeData[0].values.map(value => value);

        const fields = [
            {
                fieldtype: 'Link',
                fieldname: 'item_code',
                hidden: 1,
                label: 'item_code',
            },
            {
                fieldtype: 'Data',
                fieldname: attributeName,
                in_list_view: 1,
                read_only: true,
                in_place_edit: false,
                disabled: 1,
                label: attributeName,
            },
            {
                fieldtype: 'Read Only',
                fieldname: 'unit_price',
                read_only: 1,
                in_place_edit: false,
                in_list_view: 1,
                label: __('Rate/Unit'),
            },
            {
                fieldtype: 'Read Only',
                fieldname: 'box_price',
                read_only: 1,
                in_place_edit: false,
                in_list_view: 1,
                label: __('Rate/Box'),
            },
            {
                fieldtype: 'Int',
                fieldname: 'ratio',
                default: 0,
                read_only: 0,
                in_list_view: 1,
                label: __('Ratio'),
            },
            {
                fieldtype: 'Data',
                fieldname: 'qty',
                default: 0,
                read_only: 0,
                in_place_edit: true,
                in_list_view: 1,
                label: __('Quantity'),
            },
        ];

        const savedDialogState = JSON.parse(sessionStorage.getItem('dialogState')) || {};
        const { total_qty, size_table } = savedDialogState;

        this.dialog = new frappe.ui.Dialog({
            title: __("Select Size"),
            fields: [
                {
                    fieldname: "total_qty",
                    fieldtype: "Int",
                    label: "<b>Total Boxes</b><br><i>Enter Total Quantity Required in boxes</i>",
                    default: total_qty || 0,
                },
                {
                    fieldname: "size_table",
                    fieldtype: "Table",
                    label: "<b>Sizes Available</b> <br><i>Select all the sizes that you require</i>",
                    cannot_add_rows: 1,
                    cannot_delete_rows: true,
                    in_place_edit: false,
                    reqd: 1,
                    data: this.data,
                    get_data: () => this.data,
                    fields: fields
                }
            ],
            primary_action: async () => {
                const totalQty = this.dialog.get_value('total_qty');
                const tableData = this.dialog.get_value('size_table');

                // Filter and process only the checked rows
                const validRows = tableData.filter((row) => row.qty > 0 && row.__checked);

                // Validate if at least one row has a non-zero quantity
                if (validRows.length === 0) {
                    frappe.throw(__('Please make sure atleast one selected size has some quantity.'));
                    return;
                }

                const itemCodes = validRows.map(row => row.item_code);
                const quantities = validRows.map(row => row.qty);

                // Display the progress indicator
                const progressTitle = __('Updating Cart');
                const progressCount = 0;
                const progressTotal = itemCodes.length;
                const progressDescription = __('Updating cart items...');
                frappe.show_progress(progressTitle, progressCount, progressTotal, progressDescription);

                // Update the cart for each item code and quantity
                for (let i = 0; i < itemCodes.length; i++) {
                    const itemCode = itemCodes[i];
                    const qty = quantities[i];

                    // Update the cart for the current item code and quantity
                    await erpnext.e_commerce.shopping_cart.update_cart({
                        item_code: itemCode,
                        qty: qty,
                    });

                    // Update the progress indicator count
                    frappe.show_progress(progressTitle, i + 1, progressTotal, progressDescription);
                }

                // Hide the progress indicator after cart update completion
                frappe.hide_progress();

                // Clear sessionStorage after updating the cart
                sessionStorage.removeItem('dialogState');
                this.dialog.hide();
                frappe.msgprint({
                    title: __('Success'),
                    indicator: 'green',
                    message: __('Items successfully added to cart'),
                    primary_action: {
                        action() {
                            // Redirect to the cart page
                            window.location.href = '/cart';
                        },
                        label: __('Go to Cart')
                    }
                });
            },
            primary_action_label: __('Update cart'),
            secondary_action: () => {
                const totalValue = this.dialog.get_value('total_qty');
                if (!totalValue) {
                    frappe.throw(__('Please enter the total quantity.'));
                    return;
                }

                const tableData = this.dialog.get_value('size_table');
                const selectedRows = tableData.filter(row => row.__checked);

                if (selectedRows.length === 0) {
                    frappe.throw(__('Please select at least one row.'));
                    return;
                }

                const ratios = tableData.map(row => {
                    if (selectedRows.includes(row)) {
                        return row.ratio !== undefined ? row.ratio : 1;
                    } else {
                        return 0;
                    }
                });

                const totalRatio = ratios.reduce((sum, ratio) => sum + ratio, 0);
                const requiredQtyArray = ratios.map(ratio => Math.round((totalValue * ratio) / totalRatio / 5) * 5);

                const tableField = this.dialog.fields_dict.size_table;
                const gridRows = tableField.grid.grid_rows;

                gridRows.forEach((gridRow, index) => {
                    const doc = gridRow.doc;
                    doc.qty = requiredQtyArray[index];

                    if (selectedRows.includes(doc)) {
                        doc.ratio = doc.ratio !== undefined ? doc.ratio : 1;
                    } else {
                        doc.ratio = undefined;
                    }

                    gridRow.refresh_field("qty");
                    gridRow.refresh_field("ratio");
                });
            },
            secondary_action_label: __('Get Quantity from Ratio'),
        });
        this.dialog.set_values(savedDialogState);

        const dialogBody = this.dialog.get_field('size_table').$wrapper.parent();

        // Create a custom HTML element using frappe.ui.form.make_control
        const customTextElement = frappe.ui.form.make_control({
            df: {
                fieldtype: 'HTML',
                label: 'Custom Text',
            },
            render_input: true,
            parent: dialogBody,
        });

        customTextElement.set_value('You will get quantity in <b>Equal Ratio</b> if no ratio mentioned <br> Click on the <b><i>Get Quantity from Ratio</i></b> button to get quantities for each size');

        if (size_table) {
            const tableField = this.dialog.fields_dict.size_table;
            const gridRows = tableField.grid.grid_rows;

            size_table.forEach((row, index) => {
                gridRows[index].doc.qty = row.qty;
                gridRows[index].doc.ratio = row.ratio;
            });

            tableField.grid.refresh();
        }

        this.dialog.onhide = () => {
            const dialogValues = this.dialog.get_values();
            const dialogState = {
                total_qty: dialogValues.total_qty,
                size_table: dialogValues.size_table
            };

            sessionStorage.setItem('dialogState', JSON.stringify(dialogState));
        };


        // Clear sessionStorage on page reload or when the user leaves the page
        window.addEventListener('beforeunload', () => {
            sessionStorage.removeItem('dialogState');
        });
        this.dialog.$wrapper.find('.modal-dialog').css("max-width", "650px").css("width", "auto");

        this.dialog.show();

        $('.btn-configure').prop('disabled', false);
    }


    getNextAttributeAndValues(selectedAttributes) {
        return this.call('erpnext.e_commerce.variant_selector.utils.get_next_attribute_and_values', {
            item_code: this.itemCode,
            selected_attributes: selectedAttributes
        });
    }

    getAttributesAndValues() {
        return this.call('erpnext.e_commerce.variant_selector.utils.get_attributes_and_values', {
            item_code: this.itemCode
        });
    }

    call(method, args) {
        return new Promise((resolve, reject) => {
            frappe.call(method, args)
                .then(response => resolve(response.message))
                .fail(reject);
        });
    }
}

function setContinueConfiguration() {
    const $btnConfigure = $('.btn-configure');
    const { itemCode } = $btnConfigure.data();

    const dialogState = JSON.parse(localStorage.getItem(`configure:${itemCode}`));

    if (dialogState) {
        $btnConfigure.text(__('Continue Adding'));
    } else {
        $btnConfigure.text(__('Select Sizes'));
    }
}


frappe.ready(() => {
    const $btnConfigure = $('.btn-configure');

    if (!$btnConfigure.length) return;

    const { itemCode, itemName } = $btnConfigure.data();

    setContinueConfiguration();

    $btnConfigure.on('click', () => {
        $btnConfigure.prop('disabled', true);

        // Check if user is a guest
        if (frappe.session.user === "Guest") {
            if (localStorage) {
                localStorage.setItem("last_visited", window.location.pathname);
            }
            frappe.call('erpnext.e_commerce.api.get_guest_redirect_on_action').then((res) => {
                const redirectUrl = res.message || "/login";
                window.location.href = redirectUrl;
            });
            return;
        }

        new ItemConfigure(itemCode, itemName);
    });

    // Clear sessionStorage on page reload or when the user leaves the page
    window.addEventListener('beforeunload', () => {
        sessionStorage.clear();
    });
});