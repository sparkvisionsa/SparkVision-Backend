# Document OCR models

Arabic and English Tesseract LSTM models are bundled so extraction runs without
network downloads or an API key in both local and Docker deployments.

- `ara.traineddata`: `tesseract-ocr/tessdata_best`, converted to an integer model
  with Tesseract's `lstmtraining --stop_training --convert_to_int` for compatibility
  with the Tesseract.js WASM runtime.
- `eng.traineddata`: the existing Tesseract.js English LSTM model.

Upstream models: https://github.com/tesseract-ocr/tessdata_best
License: Apache-2.0, https://github.com/tesseract-ocr/tessdata_best/blob/main/LICENSE

These files contain model weights only. User documents are kept separately in
the authenticated MongoDB history and GridFS source bucket.
