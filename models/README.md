# PP-DocLayoutV2

This directory contains only the PP-DocLayoutV2 ONNX layout weights used by the MinerU 4 small-model bundle. The runtime uses ONNX Runtime CPU directly. There is no dependency on the MinerU Python package.

- Upstream bundle: https://huggingface.co/opendatalab/MinerU-4_models_onnx
- Original model: https://huggingface.co/PaddlePaddle/PP-DocLayoutV2
- Bundle path: Layout/PP-DocLayoutV2/inference.onnx
- Local filename: pp-doclayoutv2.onnx
- SHA-256: cd540dc296ff3115fe78efa65b68501e6a8dc74b198acc9834a725ffaa095aac
- Size: 213963712 bytes

Keep the weights separate from the application source. The desktop worker verifies the weights before loading.

Original model license: Apache-2.0. See LICENSE-PP-DocLayoutV2.
