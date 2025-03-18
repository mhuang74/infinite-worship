import unittest
import numpy as np
from Remixatron import symmetrize_matrix

class TestMatrixSymmetrization(unittest.TestCase):
    def setUp(self):
        """Set up test matrices that will be used across multiple tests"""
        self.test_cases = [
            np.array([[1, 2, 3], 
                     [4, 5, 6],
                     [7, 8, 9]], dtype=float),
            np.array([[1, 2], 
                     [3, 4]], dtype=float),
            np.random.rand(5,5),  # Random 5x5 matrix
        ]
    def test_symmetrize_matrix_output_is_symmetric(self):
        """Test that symmetrize_matrix output is symmetric"""
        for i, test_matrix in enumerate(self.test_cases):
            with self.subTest(test_case=i):
                result = symmetrize_matrix(test_matrix)
                is_symmetric = np.allclose(result, result.T)
                if not is_symmetric:
                    print(f"\nTest case {i+1} failed symmetry check:")
                    print("Original matrix:")
                    print(test_matrix)
                    print("\nResult matrix:")
                    print(result)
                    print("\nTransposed result matrix:")
                    print(result.T)
                self.assertTrue(is_symmetric,
                              f"symmetrize_matrix output is not symmetric for test case {i+1}")


    def test_symmetrize_matrix_non_square_input(self):
        """Test that symmetrize_matrix properly handles non-square matrices"""
        non_square = np.array([[1, 2, 3], [4, 5, 6]], dtype=float)  # 2x3 matrix
        with self.assertRaises(ValueError):
            symmetrize_matrix(non_square)


if __name__ == '__main__':
    unittest.main()