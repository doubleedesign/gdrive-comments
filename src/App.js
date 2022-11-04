import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import {Document, Page} from 'react-pdf/dist/umd/entry.webpack';
import file from './YOUR_FILENAME.pdf';
import './App.scss';

// Refs:
// https://codesandbox.io/s/displaying-pdf-using-react-5d003
// https://developers.google.com/drive/api/guides/manage-comments
// https://developers.google.com/oauthplayground/
// https://jsfiddle.net/wware/fksmjzah/ (Canvas click events)

// Get an access token:
// https://developers.google.com/oauthplayground/

function App() {
	const [numPages, setNumPages] = useState(null);
	const [currentPage, setCurrentPage] = useState(4);
	const [canvas, setCanvas] = useState(null);
	const [comments, setComments] = useState([]);
	const [commentsLoaded, setCommentsLoaded] = useState(false); // set this when all pages of comments have loaded
	const [pageLoaded, setPageLoaded] = useState(false);
	const [unresolved, setUnresolved] = useState([]);
	const [currentPageComments, setCurrentPageComments] = useState([]);
	const [problems, setProblems] = useState([]);
	const [statusMessage, setStatusMessage] = useState(null);
	const fileId = 'YOUR_GDRIVE_FILE_ID';
	const fields = 'id, resolved, content, anchor';
	const auth = 'Bearer YOUR_OAUTH_TOKEN_HERE';

	function onDocumentLoadSuccess({ numPages }) {
		setNumPages(numPages);
		setPageLoaded(true);
	}

	function onDocumentLoadError(error) {
		console.error(error);
	}

	function changePage(offset) {
		setPageLoaded(false);
		setCurrentPage(prevPageNumber => prevPageNumber + offset);
	}

	function onPageLoadSuccess() {
		setPageLoaded(true);
	}

	function previousPage() {
		changePage(-1);
	}

	function nextPage() {
		changePage(1);
	}

	const goToPage = page => {
		setCurrentPage(page);
	};

	// Get all the comments on the document
	function fetchComments() {
		console.log('fetching comments');
		setStatusMessage('Fetching comments');
		let results = [];
		let tokens = []; // hack: track the page tokens so we don't get the same page twice when useEffect renders twice

		const config = {
			method: 'get',
			url: `https://www.googleapis.com/drive/v3/files/${fileId}/comments?fields=comments(${fields}),nextPageToken&pageSize=100&includeDeleted=false`,
			headers: {
				'Authorization': auth
			}
		};

		function fetchMoreComments(pageToken) {
			if(pageToken && !tokens.includes(pageToken)) {
				tokens.push(pageToken);
				const config = {
					method: 'get',
					url: `https://www.googleapis.com/drive/v3/files/${fileId}/comments?fields=comments(${fields}),nextPageToken&pageSize=100&includeDeleted=false&pageToken=${pageToken}`,
					headers: {
						'Authorization': auth
					}
				};

				axios(config)
					.then(function (response) {
						results = results.concat(response.data.comments);
						if(response.data.nextPageToken !== '') {
							fetchMoreComments(response.data.nextPageToken);
						}
					})
					.catch(function (error) {
						//console.error(error);
					});
			}
			else {
				setComments(results);
				setCommentsLoaded(true); // pageToken is undefined = there's no more pages = we're done
			}
		}

		axios(config)
			.then(function (response) {
				results = results.concat(response.data.comments);
				if(response.data.nextPageToken !== '') {
					fetchMoreComments(response.data.nextPageToken); // this will recursively load each page of comments
				}
				else {
					setComments(results);
					setCommentsLoaded(true); // only one page, we're done loading
					setStatusMessage(null);
				}
			})
			.catch(function (error) {
				console.error(error);
			});

	}

	// Filter returned comments to get just unresolved ones and save them in state
	const getUnresolvedComments = useCallback(() => {
		if(comments.length > 0) {
			setStatusMessage('Filtering comments');
			const filtered = comments.filter(comment => comment.resolved !== true);
			setUnresolved(filtered);
		}
		else {
			setUnresolved([]);
		}
	}, [comments]);

	// Wait for state to finish updating before turning updating status off
	useEffect(() => {
		setStatusMessage(null);
	}, [unresolved]);

	// Filter unresolved comments to just the current spread and save them in state
	const getCurrentSpreadComments = useCallback(() => {
		let spreadPage;
		let anchorBox = [];
		let results = [];
		let warnings = [];

		// Filter the comments
		unresolved.map(comment => {
			const anchorData = (JSON.parse(comment.anchor));
			if(anchorData[2]) {
				spreadPage = anchorData[2][0][0][0];
				anchorBox = anchorData[2][0];
			}
			else if(anchorData[1]) {
				spreadPage = anchorData[1][0];
			}
			else {
				console.warn(`Unable to load spread number of comment ${comment.id}`);
				warnings.push(comment);
				return false;
			}

			if(spreadPage && spreadPage + 1 === currentPage) {
				comment.anchorBox = anchorBox;
				results.push(comment);
			}

			return true;
		})

		setCurrentPageComments(results.reverse()); // comments are in reverse order at the time of writing this app for some reason
		setProblems(warnings);
	}, [currentPage, unresolved]);

	// Draw markers for the current spread on the PDF canvas
	// TODO: Make them clickable
	const updateMarkers = useCallback(() => {

		if(currentPageComments.length > 0) {
			const ctx = canvas.getContext('2d');
			setStatusMessage('Updating markers');

			// Default colour
			ctx.fillStyle = 'rgba(253,216,53,0.4)';
			currentPageComments.map(async comment => {
				if (comment.anchorBox && comment.anchorBox[0]) {
					const x = comment.anchorBox[0][1][0][0] * canvas.width;
					const y = comment.anchorBox[0][1][0][1] * canvas.height;
					const x2 = comment.anchorBox[0][1][0][2] * canvas.width;
					const y2 = comment.anchorBox[0][1][0][3] * canvas.height;
					const w = x2 - x;
					const h = y2 - y;
					ctx.fillRect(x, y, w, h);
				} else {
					console.warn(`Problem loading anchor data for comment ${comment.id}`);
				}

				return true;
			});

			// Highlight the first one
			if (currentPageComments[0].anchorBox) {
				const x = currentPageComments[0].anchorBox[0][1][0][0] * canvas.width;
				const y = currentPageComments[0].anchorBox[0][1][0][1] * canvas.height;
				const x2 = currentPageComments[0].anchorBox[0][1][0][2] * canvas.width;
				const y2 = currentPageComments[0].anchorBox[0][1][0][3] * canvas.height;
				const w = x2 - x;
				const h = y2 - y;
				ctx.clearRect(x, y, w, h);

				ctx.strokeStyle = '#d81b60';
				ctx.fillStyle = 'rgba(216,27,96,0.2)';
				ctx.lineWidth = 0.5;
				ctx.fillRect(x, y, w, h);
				ctx.strokeRect(x, y, w, h);
			} else {
				console.warn(`Problem loading anchor data for comment ${currentPageComments[0].id}`);
			}

			setStatusMessage(null);
		}
	}, [currentPageComments]);

	// Fetch data for a single comment
	const fetchSingleComment = async (id) => {

		const config = {
			method: 'get',
			url: `https://www.googleapis.com/drive/v3/files/${fileId}/comments/${id}?fields=${fields}`,
			headers: {
				'Authorization': auth
			}
		};

		return new Promise((resolve, reject) => {
			axios(config)
				.then(res => {
					resolve(res.data)
				})
				.catch(err => {
					reject(err);
				})
		})

	};

	// Resolve a comment
	const resolveComment = (id) => {
		setStatusMessage(`Resolving comment ${id}`);
		const url = `https://www.googleapis.com/drive/v3/files/${fileId}/comments/${id}/replies?fields=*`;

		// Send a comment reply with a "resolve" action
		async function resolveTheThing() {
			let comment;

			await axios({
				method: 'post',
				url: url,
				headers: {
					'Authorization': auth
				},
				data: {
					action: 'resolve'
				}
			})
			.then(response => {
				comment = response.data;
			})
			.catch(error => {
				console.log(error);
			});

			return comment;
		}

		// Perform the action; returns the comment reply
		resolveTheThing().then(() => {

			// Fetch the comment and check if it was actually resolved
			fetchSingleComment(id).then((comment) => {
				if(comment.resolved) {
					console.log(`Comment ${comment.id} resolved`);
					return comment;
				}
				else {
					console.warn(`Comment ${comment.id} not resolved`)
				}
			})
			.then((comment) => {
				// Update it in the local lists so we don't do another API query and re-filter everything
				// just to refresh the comments on the page
				const temp1 = comments;
				const index1 = temp1.findIndex(x => {
					return x.id === comment.id;
				});
				temp1[index1] = comment;
				setComments(temp1);

				const temp2 = unresolved;
				const index2 = temp2.findIndex(x => {
					return x.id === comment.id;
				});
				temp2.splice(index2, 1);
				setUnresolved(temp2);

				const temp3 = currentPageComments;
				const index3 = temp3.findIndex(x => {
					return x.id === comment.id;
				});
				temp3.splice(index3, 1);
				setCurrentPageComments(temp3);

				setStatusMessage(null);
				updateMarkers();
			})
		});
	};

	// Get all comments on load
	useEffect(() => {
		fetchComments();
	}, [comments.length]);

	// Filter the comments for just unresolved ones
	// Do this after all pages of comments have loaded, not every time "comments" changes
	useEffect(() => {
		if(commentsLoaded) {
			getUnresolvedComments();
			console.log(`${unresolved.length} comments are unresolved`);
		}
	}, [commentsLoaded, getUnresolvedComments, unresolved.length]);

	// Get current spread's comments
	useEffect(() => {
		if(unresolved.length > 0) {
			getCurrentSpreadComments();
		}
	}, [currentPage, getCurrentSpreadComments, unresolved]);

	// Find the canvas after page load and clear previous markers
	useEffect(() => {
		if(pageLoaded) {
			const theCanvas = document.querySelector('.comment-layer');
			if(theCanvas) {
				const ctx = theCanvas.getContext('2d');
				ctx.clearRect(0, 0, theCanvas.width, theCanvas.height);
				setCanvas(theCanvas);
			}

			updateMarkers();
		}
	}, [canvas, pageLoaded, updateMarkers]);


	return (
		<div className="App">
			<div className="document-wrapper">
				<Document file={file}
				          onLoadSuccess={onDocumentLoadSuccess}
				          onLoadError={onDocumentLoadError}
					>
					<Page pageNumber={currentPage} onRenderSuccess={onPageLoadSuccess}/>
				</Document>
				<canvas className="comment-layer"></canvas>
				<div className="pagination">
					<p className="pagination__description">
						Spread {currentPage || (numPages ? 1 : "--")} of {numPages || "--"}
					</p>
					<button type="button"
					        className="button button--navigation"
					        disabled={currentPage <= 1}
					        onClick={previousPage}>
						Previous
					</button>
					<button
						type="button"
						className="button button--navigation"
						disabled={currentPage >= numPages}
						onClick={nextPage}
					>
						Next
					</button>
				</div>
			</div>
			<div className="comments-wrapper">
				<div className="status">
					<h2>Resolution progress</h2>
					<div className="status__progress-bar">
						<span style={{width: `${((comments.length - unresolved.length) / comments.length) * 100}%`}}>
							{Math.round(((comments.length - unresolved.length) / comments.length) * 100)}%
						</span>
					</div>
					<p>There are <strong>{unresolved.length}</strong> unresolved comments.</p>
				</div>
				<h2>Comments on this spread</h2>
				<p>There are <strong>{currentPageComments.length}</strong> unresolved comments on this spread.</p>
				{currentPageComments && currentPageComments.length > 0 ?
					<ul className="comments">
						{currentPageComments.map((comment, index) => {
							return (
								<li key={comment.id} className={`comments__item comments__item--unresolved comments__item__${index}`}>
									<span className="comments__item__description">{comment.content}</span>
									<button className="button button--action" onClick={() => resolveComment(comment.id)}>Resolve</button>
								</li>
							);
						})}
					</ul>
				:  <div className="alert alert--success">No unresolved comments on this spread.</div> }

				<h2>Problems in this file</h2>
				{problems.map(comment => {
					return (
						<li key={comment.id} className="comments__item comments__item--unresolved">
							<span className="comments__item__description">
								{comment.content}
								<small>Check dev console, but this comment probably has no anchor and will need to be found and resolved in the Google Drive app.</small>
							</span>
						</li>
					);
				})}
			</div>
			{statusMessage && <div className="loading-overlay"><p>{statusMessage}</p></div>}
		</div>
	);
}

export default App;
