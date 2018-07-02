import React, { Component } from 'react';
import Board from './Board';
import PropTypes from 'prop-types';
import isEqual from 'lodash.isequal';
import { DragDropContext } from 'react-dnd';
import MultiBackend from 'react-dnd-multi-backend';
import HTML5toTouch from 'react-dnd-multi-backend/lib/HTML5toTouch';

import SparePieces from './SparePieces';
import {
  fenToObj,
  validFen,
  validPositionObject,
  constructPositionAttributes
} from './helpers';
import CustomDragLayer from './CustomDragLayer';
import defaultPieces from './svg/chesspieces/standard';
import { renderPieces } from './RenderPieces';
import ErrorBoundary from './ErrorBoundary';

const ChessboardContext = React.createContext();

const getPositionObject = position => {
  if (position === 'start')
    return fenToObj('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
  if (validFen(position)) return fenToObj(position);
  if (validPositionObject(position)) return position;

  return {};
};

class Chessboard extends Component {
  static propTypes = {
    /**
     * The position to display on the board.  Can be either a FEN string or a position object.
     */
    position: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
    /**
     * If 'black' then row 8 will be the bottom row, if 'white' row 1 will be the bottom row.
     */
    orientation: PropTypes.oneOf(['white', 'black']),
    /**
     * If true, spare pieces will appear above and below the board.
     */
    sparePieces: PropTypes.bool,
    /**
     * The width in pixels.  For a responsive width, use calcWidth.
     */
    width: PropTypes.number,
    defaultPieces: PropTypes.objectOf(PropTypes.object),
    /**
     * The behavior of the piece when dropped off the board. 'snapback' brings the piece
     * back to it's original square and 'trash' deletes the piece from the board
     */
    dropOffBoard: PropTypes.oneOf(['snapback', 'trash']),
    /**
     * The logic to be performed after the drop.  This is where to check if moves are legal with
     * a library like chess.js.
     *
     * Signature: function(sourceSquare: string, targetSquare: string) => void
     */
    onDrop: PropTypes.func,
    /**
     * If false, the pieces will not be draggable
     */
    draggable: PropTypes.bool,
    /**
     * The time it takes for a piece to slide to the target square.  This is only used
     * when the next position comes from the position prop.  If the next position comes in before
     * the transition is complete, then the animation will appear glitchey.
     */
    transitionDuration: PropTypes.number,
    /**
     * If false, no notation will be shown on the board.
     */
    showNotation: PropTypes.bool,
    /**
     * The style object for the light square.
     */
    lightSquareStyle: PropTypes.object,
    /**
     * The style object for the dark square.
     */
    darkSquareStyle: PropTypes.object,
    /**
     * The style object for the board.
     */
    boardStyle: PropTypes.object,
    /**
     * The id is necessary if more than one board is mounted.
     * This is needed to identify the correct dropzone for the piece.
     */
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    /**
     * A function that gives access to the underlying square element.  This
     * allows for more customizations with rough.js.
     *
     * Signature: function(node, squareWidth: number) => void
     * node: the underlying dom node for the square
     */
    roughSquare: PropTypes.func,
    /**
     * A collection of squares, useful for legal move highlighting
     */
    selectedSquares: PropTypes.array,
    /**
     * The style object for the selected squares.
     */
    selectedSquareStyle: PropTypes.object,
    /**
     * A function to call when the mouse is over the square.  It takes one argument, the square
     * that the mouse is over (onMouseOverSquare(square)).  Not compatable with touch devices.
     *
     * Signature: function(square: string) => void
     */
    onMouseOverSquare: PropTypes.func,
    /**
     * A function to call when the mouse has left the square.
     *
     * Signature: function() => void
     */
    onMouseOutSquare: PropTypes.func,
    /**
     * The style object for the hovered square.
     */
    onHoverSquareStyle: PropTypes.object,
    renderPieces: PropTypes.func,
    /**
     * An object containing custom pieces.  The values can be imported images or
     * svg objects.
     */
    pieces: PropTypes.object,
    /**
     * A function for responsive width control, returns width.
     *
     * Signature: function(screenWidth: number, screenHeight: number) => void
     */
    calcWidth: PropTypes.func,
    /**
     * A function that gives access to the current position object.
     *
     * Signature: function(currentPosition: object) => void
     */
    getPosition: PropTypes.func
  };

  static defaultProps = {
    width: 560,
    calcWidth: () => {},
    orientation: 'white',
    showNotation: true,
    position: '',
    sparePieces: false,
    draggable: true,
    dropOffBoard: 'snapback',
    defaultPieces,
    onDrop: () => {},
    transitionDuration: 300,
    boardStyle: {},
    id: '0',
    renderPieces,
    pieces: {},
    lightSquareStyle: { backgroundColor: 'rgb(240, 217, 181)' },
    darkSquareStyle: { backgroundColor: 'rgb(181, 136, 99)' },
    roughSquare: () => {},
    selectedSquares: [],
    onMouseOverSquare: () => {},
    onMouseOutSquare: () => {},
    onHoverSquareStyle: { boxShadow: `inset 0 0 1px 4px yellow` },
    selectedSquareStyle: {
      background: `radial-gradient(circle, #fffc00 36%, transparent 40%)`,
      borderRadius: `50%`
    },
    getPosition: () => {}
  };

  static Consumer = ChessboardContext.Consumer;

  state = {
    previousPositionFromProps: null,
    currentPosition: getPositionObject(this.props.position),
    sourceSquare: '',
    targetSquare: '',
    sourcePiece: '',
    waitForTransition: false,
    phantomPiece: null,
    wasPieceTouched: false,
    manualDrop: false,
    pieces: {}
  };

  componentDidMount() {
    this.setState({
      pieces: { ...this.props.defaultPieces, ...this.props.pieces }
    });
    this.updateWindowDimensions();
    window.addEventListener('resize', this.updateWindowDimensions);
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.updateWindowDimensions);
  }

  updateWindowDimensions = () => {
    this.setState({
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight
    });
  };

  componentDidUpdate(prevProps) {
    const { position, transitionDuration, getPosition } = this.props;
    const { waitForTransition } = this.state;
    const positionFromProps = getPositionObject(position);
    const previousPositionFromProps = getPositionObject(prevProps.position);

    // Check if there is a new position coming from props
    if (!isEqual(positionFromProps, previousPositionFromProps)) {
      this.setState({ previousPositionFromProps });
      // get board position for user
      getPosition(positionFromProps);

      // Give piece time to transition.
      if (waitForTransition) {
        return new Promise(resolve => {
          this.setState({ currentPosition: positionFromProps }, () =>
            setTimeout(() => {
              this.setState({ waitForTransition: false });
              resolve();
            }, transitionDuration)
          );
        }).then(() =>
          setTimeout(
            () => this.setState({ phantomPiece: null }),
            transitionDuration
          )
        );
      }
    }
  }

  static getDerivedStateFromProps(props, state) {
    const { position } = props;
    const { currentPosition, previousPositionFromProps, manualDrop } = state;
    let positionFromProps = getPositionObject(position);

    // If positionFromProps is a new position then execute, else null
    if (
      previousPositionFromProps &&
      !isEqual(positionFromProps, previousPositionFromProps) &&
      !isEqual(positionFromProps, currentPosition)
    ) {
      // Get position attributes from the difference between currentPosition and positionFromProps
      const {
        sourceSquare,
        targetSquare,
        sourcePiece,
        squaresAffected
      } = constructPositionAttributes(currentPosition, positionFromProps);

      if (manualDrop) {
        return {
          sourceSquare,
          targetSquare,
          sourcePiece,
          currentPosition: positionFromProps,
          waitForTransition: false,
          manualDrop: false
        };
      }

      /* If the new position involves many pieces, then disregard the transition effect.
        Possible to add functionality for transitioning of multiple pieces later */
      if (squaresAffected && squaresAffected !== 2) {
        return {
          currentPosition: positionFromProps,
          waitForTransition: false,
          manualDrop: false
        };
      }

      // Check if currentPosition has a piece occupying the target square
      if (currentPosition[targetSquare]) {
        // Temporarily delete the target square from the new position
        delete positionFromProps[targetSquare];

        return {
          sourceSquare,
          targetSquare,
          sourcePiece,
          // Set the current position to the new position minus the targetSquare
          currentPosition: positionFromProps,
          waitForTransition: true,
          // Create a phantom piece as a stand in
          phantomPiece: { [targetSquare]: currentPosition[targetSquare] },
          manualDrop: false
        };
      }

      return {
        sourceSquare,
        targetSquare,
        sourcePiece,
        currentPosition: positionFromProps,
        waitForTransition: true,
        manualDrop: false
      };
    }
    return null;
  }

  wasManuallyDropped = bool => this.setState({ manualDrop: bool });

  /* Called on drop if there is no onDrop prop.  This is what executes when a position does not
   change through the position prop, i.e., simple drag and drop operations on the pieces.*/
  setPosition = (piece, sourceSquare, targetSquare = null) => {
    const { currentPosition } = this.state;
    const { getPosition, dropOffBoard } = this.props;
    if (sourceSquare === targetSquare) return;

    if (dropOffBoard === 'trash' && !targetSquare) {
      let newPosition = currentPosition;
      delete newPosition[sourceSquare];
      this.setState({ currentPosition: newPosition });
      // get board position for user
      return getPosition(currentPosition);
    }

    let newPosition = currentPosition;
    sourceSquare !== 'spare' && delete newPosition[sourceSquare];
    newPosition[targetSquare] = piece;

    this.setState(() => ({ currentPosition: newPosition }));
    // get board position for user
    getPosition(currentPosition);
  };

  // Allows for touch drag and drop
  setTouchState = e => this.setState({ wasPieceTouched: e.isTrusted });

  render() {
    const {
      sparePieces,
      width,
      id,
      calcWidth,
      orientation,
      dropOffBoard
    } = this.props;
    const {
      sourceSquare,
      targetSquare,
      sourcePiece,
      waitForTransition,
      phantomPiece,
      wasPieceTouched,
      currentPosition,
      manualDrop,
      screenWidth,
      screenHeight,
      pieces
    } = this.state;
    return (
      <ErrorBoundary>
        <ChessboardContext.Provider
          value={{
            ...this.props,
            pieces: Object.keys(pieces).length ? pieces : defaultPieces,
            orientation: orientation.toLowerCase(),
            dropOffBoard: dropOffBoard.toLowerCase(),
            ...{
              width: calcWidth(screenWidth, screenHeight)
                ? calcWidth(screenWidth, screenHeight)
                : width,
              sourceSquare,
              targetSquare,
              sourcePiece,
              waitForTransition,
              phantomPiece,
              setPosition: this.setPosition,
              manualDrop,
              setTouchState: this.setTouchState,
              currentPosition,
              screenWidth,
              screenHeight,
              wasManuallyDropped: this.wasManuallyDropped
            }
          }}
        >
          <div>
            {sparePieces && <SparePieces.Top />}
            <Board {...this.props} />
            {sparePieces && <SparePieces.Bottom />}
          </div>
          <CustomDragLayer
            width={
              calcWidth(screenWidth, screenHeight)
                ? calcWidth(screenWidth, screenHeight)
                : width
            }
            pieces={Object.keys(pieces).length ? pieces : defaultPieces}
            id={id}
            wasPieceTouched={wasPieceTouched}
          />
        </ChessboardContext.Provider>
      </ErrorBoundary>
    );
  }
}

export default DragDropContext(MultiBackend(HTML5toTouch))(Chessboard);
